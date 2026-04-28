// PocketOption WebSocket client
// Based on real Socket.IO Engine.IO v4 protocol
// Reference: https://github.com/Mastaaa1987/PocketOptionAPI-v2
//
// Connection flow:
// 1. HTTP GET /socket.io/?EIO=4&transport=polling → get sid
// 2. WebSocket connect wss://host/socket.io/?EIO=4&transport=websocket&sid=xxx
// 3. Server sends "0{...}" (Engine.IO OPEN) → client sends "40" (Socket.IO CONNECT)
// 4. Server sends "40{sid:...}" → client sends 42["auth",...] (SSID)
// 5. Server sends 451-["successauth",...] → authenticated!

import WebSocket from "ws";
import https from "https";

// ============ Types ============

export interface CandleData {
  asset: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  timestamp: number;
}

export interface PocketOptionTrade {
  id: string;
  asset: string;
  direction: "CALL" | "PUT";
  amount: number;
  profit: number;
  openPrice: number;
  closePrice: number;
  openTime: number;
  closeTime: number;
  result: "WIN" | "LOSS";
}

interface TradeResult {
  win: boolean;
  profit: number;
  openPrice: number;
  closePrice: number;
  tradeId: string;
}

// ============ Constants ============

const HOSTS = {
  demo: "demo-api-eu.po.market",
  real: "api-eu.po.market",
};

const WS_HEADERS = {
  Origin: "https://pocketoption.com",
  "Cache-Control": "no-cache",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
};

// ============ Client ============

export class PocketOptionClient {
  private ssid: string; // Full 42["auth",...] message
  private ws: WebSocket | null = null;
  private connected = false;
  private authenticated = false;
  private isDemo = true;

  // Callbacks
  private onAuthCallbacks: (() => void)[] = [];
  private candleListeners = new Map<
    string,
    ((candle: CandleData) => void)[]
  >();
  private onBalanceCallbacks: ((balance: {
    balance: number;
    isDemo: number;
  }) => void)[] = [];
  private onErrorCallbacks: ((error: Error) => void)[] = [];
  private onSsidExpiredCallbacks: (() => void)[] = [];

  // Active subscriptions tracking
  private activeSubscriptions = new Map<
    string,
    { asset: string; size: number }
  >();
  private currentSymbol: { asset: string; period: number } | null = null;

  // State flags for binary message handling
  private updateStreamFlag = false;
  private updateClosedDealsFlag = false;
  private loadHistoryPeriodFlag = false;
  private successOpenOrderFlag = false;

  // Cached response data
  private historyPeriodData: Record<string, unknown> | null = null;
  private orderData: Record<string, unknown> | null = null;
  private historyNewData: Record<string, unknown> | null = null;
  private closedDealsData: unknown[] = [];
  private lastBalance: { balance: number; isDemo: number } | null = null;

  // Heartbeat
  private socketIoHeartbeat: ReturnType<typeof setInterval> | null = null;

  // Reconnection
  private reconnectAttempts = 0;
  private maxReconnectDelay = 60000;
  private intentionallyClosed = false;

  // SSID expiration tracking
  private ssidExpired = false;

  constructor(ssid: string) {
    this.ssid = ssid;
  }

  get isConnected(): boolean {
    return this.connected && this.authenticated;
  }

  get isSsidExpired(): boolean {
    return this.ssidExpired;
  }

  get balance(): { balance: number; isDemo: number } | null {
    return this.lastBalance;
  }

  // ============ Asset Format Conversion ============

  /** Convert display format to PocketOption wire format
   *  "EUR/USD (OTC)" → "EURUSD_otc"
   *  "EUR/USD"       → "EURUSD"
   *  "BTC/USD"       → "BTCUSD"
   */
  static toPOSymbol(asset: string): string {
    if (asset.includes("(OTC)")) {
      return asset.replace("/", "").replace(" (OTC)", "_otc");
    }
    if (asset.includes("/")) {
      return asset.replace("/", "");
    }
    return asset;
  }

  // ============ Connection ============

  async connect(isDemo?: boolean): Promise<void> {
    if (this.connected && this.authenticated) return;

    this.isDemo = isDemo ?? this.parseIsDemoFromSsid();
    this.intentionallyClosed = false;
    this.ssidExpired = false;

    const host = this.isDemo ? HOSTS.demo : HOSTS.real;

    // Direct WebSocket connection (like Python reference implementation)
    const wsUrl = `wss://${host}/socket.io/?EIO=4&transport=websocket`;
    console.log(`[PO] Connecting WebSocket to ${host}...`);

    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(wsUrl, {
          headers: WS_HEADERS,
          handshakeTimeout: 15000,
        });

        const timeout = setTimeout(() => {
          reject(new Error("Connection timeout (15s)"));
          this.ws?.close();
        }, 15000);

        this.ws.on("open", () => {
          console.log("[PO] WebSocket connected, waiting for handshake...");
        });

        this.ws.on("message", (raw: WebSocket.Data) => {
          try {
            // PocketOption server may send text protocol messages as binary Buffers.
            // Check if the buffer starts with a known text prefix before routing.
            let text: string | null = null;
            if (Buffer.isBuffer(raw)) {
              text = raw.toString("utf8");
            } else if (typeof raw === "string") {
              text = raw;
            } else {
              text = raw.toString();
            }

            // Check if this is a text protocol message (Engine.IO / Socket.IO)
            const firstChar = text.charAt(0);
            if (
              firstChar === "0" || // Engine.IO OPEN
              firstChar === "2" || // Engine.IO PING
              firstChar === "3" || // Engine.IO PONG
              firstChar === "4" || // Socket.IO (40, 42, 451-)
              text.startsWith('42["ps"]') // heartbeat
            ) {
              this.handleTextMessage(text, resolve, reject, timeout);
            } else {
              // Binary data (balance, order, tick data, etc.)
              const buf = Buffer.isBuffer(raw)
                ? raw
                : Buffer.from(typeof raw === "string" ? raw : new Uint8Array(raw as ArrayBuffer));
              this.handleBinaryMessage(buf);
            }
          } catch (err) {
            console.error("[PO] Message handling error:", err);
          }
        });

        this.ws.on("close", (code: number, reason: Buffer) => {
          console.log(`[PO] WebSocket closed. Code: ${code}, Reason: ${reason.toString()}`);
          this.connected = false;
          this.authenticated = false;
          this.cleanup();

          if (!this.intentionallyClosed) {
            const delay = Math.min(
              5000 * Math.pow(2, this.reconnectAttempts),
              this.maxReconnectDelay
            );
            this.reconnectAttempts++;
            console.log(`[PO] Disconnected. Reconnecting in ${delay}ms...`);
            setTimeout(() => {
              if (!this.connected && !this.intentionallyClosed) {
                this.connect(this.isDemo).catch(() => {});
              }
            }, delay);
          }
        });

        this.ws.on("error", (err: Error) => {
          console.error(`[PO] WebSocket error: ${err.message}`);
          clearTimeout(timeout);
          this.connected = false;
          this.authenticated = false;
          this.cleanup();
          reject(err);
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  /**
   * HTTP polling handshake - required by Socket.IO before WebSocket upgrade
   */
  private pollingHandshake(host: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const options: https.RequestOptions = {
        hostname: host,
        path: "/socket.io/?EIO=4&transport=polling",
        method: "GET",
        headers: {
          ...WS_HEADERS,
          Accept: "*/*",
        },
      };

      const req = https.request(options, (res) => {
        let data = "";
        res.on("data", (chunk: Buffer) => {
          data += chunk.toString();
        });
        res.on("end", () => {
          try {
            // Response format: "0{"sid":"xxx","upgrades":["websocket"],...}"
            if (data.startsWith("0")) {
              const jsonStr = data.substring(1);
              const parsed = JSON.parse(jsonStr);
              if (parsed.sid) {
                resolve(parsed.sid);
              } else {
                reject(new Error("No sid in polling response"));
              }
            } else {
              reject(new Error(`Unexpected polling response: ${data.substring(0, 100)}`));
            }
          } catch (err) {
            reject(new Error(`Failed to parse polling response: ${err}`));
          }
        });
      });

      req.on("error", (err) => {
        reject(new Error(`Polling handshake failed: ${err.message}`));
      });

      req.setTimeout(10000, () => {
        req.destroy();
        reject(new Error("Polling handshake timeout"));
      });

      req.end();
    });
  }

  disconnect(): void {
    this.intentionallyClosed = true;
    this.cleanup();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.connected = false;
    this.authenticated = false;
  }

  // ============ Text Message Handler ============

  private handleTextMessage(
    message: string,
    resolve?: (value: void) => void,
    reject?: (error: Error) => void,
    timeout?: ReturnType<typeof setTimeout>
  ): void {
    console.log(`[PO] << ${message.substring(0, 120)}`);

    // Engine.IO OPEN: "0{sid:...}"
    if (message.startsWith("0")) {
      this.ws?.send("40"); // Socket.IO CONNECT
      return;
    }

    // Engine.IO PING: "2"
    if (message === "2") {
      this.ws?.send("3"); // Engine.IO PONG
      return;
    }

    // Socket.IO CONNECT ACK: "40{sid:...}"
    if (message.startsWith("40")) {
      // Send SSID auth message
      console.log("[PO] Socket.IO connected, sending auth...");
      this.ws?.send(this.ssid);
      return;
    }

    // Socket.IO EVENT: "42[...]"
    if (message.startsWith("42")) {
      try {
        const data = JSON.parse(message.substring(2));
        if (Array.isArray(data) && data.length >= 1) {
          if (data[0] === "NotAuthorized") {
            console.error("[PO] NotAuthorized - SSID expired or invalid");
            this.ssidExpired = true;
            this.intentionallyClosed = true; // Prevent reconnection with expired SSID
            this.authenticated = false;
            // Fire SSID expiration callbacks
            this.onSsidExpiredCallbacks.forEach((cb) => {
              try { cb(); } catch {}
            });
            if (timeout) clearTimeout(timeout);
            if (reject) reject(new Error("NotAuthorized: SSID invalide"));
            this.ws?.close();
          }
        }
      } catch {}
      return;
    }

    // Socket.IO BINARY EVENT: "451-[...]"
    if (message.startsWith("451-")) {
      const jsonPart = message.substring(message.indexOf("-") + 1);
      try {
        const data = JSON.parse(jsonPart);
        if (Array.isArray(data) && data.length >= 1) {
          this.handleSocketIOEvent(data[0], data[1], resolve, timeout);
        }
      } catch (err) {
        console.error("[PO] Failed to parse 451- message:", err);
      }
      return;
    }
  }

  // ============ Socket.IO Event Handler ============

  private handleSocketIOEvent(
    eventName: string,
    eventData: unknown,
    resolve?: (value: void) => void,
    timeout?: ReturnType<typeof setTimeout>
  ): void {
    console.log(`[PO] Event: ${eventName}`);

    switch (eventName) {
      case "successauth":
        this.authenticated = true;
        this.connected = true;
        this.reconnectAttempts = 0;
        console.log("[PO] Authenticated successfully!");

        this.startHeartbeats();

        if (timeout) clearTimeout(timeout);
        if (resolve) resolve();

        // Re-subscribe to previously active symbols
        for (const [, sub] of this.activeSubscriptions) {
          this.sendEvent(["changeSymbol", { asset: PocketOptionClient.toPOSymbol(sub.asset), period: sub.size }]);
        }

        this.onAuthCallbacks.forEach((cb) => cb());
        break;

      case "successupdateBalance":
        break;

      case "successopenOrder":
        this.successOpenOrderFlag = true;
        break;

      case "updateClosedDeals":
        this.updateClosedDealsFlag = true;
        break;

      case "successcloseOrder":
        break;

      case "loadHistoryPeriod":
      case "loadHistoryPeriodFast":
        this.loadHistoryPeriodFlag = true;
        if (eventData && typeof eventData === "object") {
          this.historyPeriodData = eventData as Record<string, unknown>;
        }
        break;

      case "updateStream":
        this.updateStreamFlag = true;
        break;

      case "updateHistoryNew":
      case "updateHistoryNewFast":
        if (eventData && typeof eventData === "object") {
          this.historyNewData = eventData as Record<string, unknown>;
          this.processHistoryNew(eventData as Record<string, unknown>);
        }
        break;

      default:
        console.log(`[PO] Unhandled event: ${eventName}`);
    }
  }

  // ============ Binary Message Handler ============

  private handleBinaryMessage(buffer: Buffer): void {
    try {
      const message = JSON.parse(buffer.toString());

      if (typeof message === "object" && message !== null && "balance" in message) {
        this.lastBalance = {
          balance: Number(message.balance),
          isDemo: Number(message.isDemo || 0),
        };
        this.onBalanceCallbacks.forEach((cb) => cb(this.lastBalance!));
        return;
      }

      if (
        typeof message === "object" &&
        message !== null &&
        "requestId" in message &&
        message.requestId === "buy"
      ) {
        this.orderData = message;
        return;
      }

      if (
        this.loadHistoryPeriodFlag &&
        typeof message === "object" &&
        message !== null &&
        "data" in message
      ) {
        this.loadHistoryPeriodFlag = false;
        this.historyPeriodData = message;
        return;
      }

      if (this.updateStreamFlag && Array.isArray(message)) {
        this.updateStreamFlag = false;
        if (message.length > 0 && Array.isArray(message[0]) && message[0].length >= 3) {
          console.log("[PO] Received tick data");
        }
        return;
      }

      if (this.updateClosedDealsFlag && Array.isArray(message)) {
        this.updateClosedDealsFlag = false;
        this.closedDealsData = message;
        return;
      }
    } catch {
      // Ignore parse errors for non-JSON binary frames
    }
  }

  // ============ History New Processing ============

  private processHistoryNew(data: Record<string, unknown>): void {
    const asset = this.currentSymbol?.asset;
    if (!asset) return;

    const candlesRaw = data.candles;
    if (Array.isArray(candlesRaw) && candlesRaw.length > 0) {
      console.log(`[PO] Received ${candlesRaw.length} candles for ${asset}`);
      for (const can of candlesRaw) {
        if (Array.isArray(can) && can.length >= 5) {
          const candle: CandleData = {
            asset,
            open: Number(can[1]),
            close: Number(can[2]),
            high: Number(can[3]),
            low: Number(can[4]),
            volume: 0,
            timestamp: Number(can[0]),
          };
          this.emitCandle(asset, candle);
        }
      }
    }

    const historyRaw = data.history;
    if (Array.isArray(historyRaw) && historyRaw.length > 0) {
      console.log(`[PO] Received ${historyRaw.length} ticks for ${asset}`);
    }
  }

  // ============ Commands ============

  changeSymbol(asset: string, period: number): void {
    this.currentSymbol = { asset, period };
    const subKey = `${asset}:${period}`;
    this.activeSubscriptions.set(subKey, { asset, size: period });
    this.sendEvent(["changeSymbol", { asset: PocketOptionClient.toPOSymbol(asset), period }]);
  }

  loadHistoryPeriod(
    asset: string,
    period: number,
    endTime: number,
    offset: number
  ): void {
    this.sendEvent([
      "loadHistoryPeriod",
      { asset: PocketOptionClient.toPOSymbol(asset), index: endTime, time: endTime, offset, period },
    ]);
  }

  openOrder(
    asset: string,
    amount: number,
    action: "call" | "put",
    isDemo: number,
    time: number
  ): void {
    this.sendEvent([
      "openOrder",
      { asset: PocketOptionClient.toPOSymbol(asset), amount, action, isDemo, requestId: "buy", optionType: 100, time },
    ]);
  }

  getBalances(): void {
    this.sendEvent({ name: "get-balances", version: "1.0" });
  }

  // ============ Async Request Methods ============

  async requestCandleHistory(
    asset: string,
    period: number,
    count: number
  ): Promise<CandleData[]> {
    if (!this.connected || !this.authenticated) return [];

    this.historyPeriodData = null;
    this.loadHistoryPeriodFlag = false;

    const endTime = Math.floor(Date.now() / 1000);
    this.loadHistoryPeriod(asset, period, endTime, count);

    for (let i = 0; i < 100; i++) {
      if (this.historyPeriodData !== null) break;
      await new Promise((r) => setTimeout(r, 100));
    }

    if (!this.historyPeriodData) return [];

    const dataArr = (this.historyPeriodData as Record<string, unknown>).data;
    if (!Array.isArray(dataArr)) return [];

    return dataArr
      .map((c: Record<string, unknown>) => ({
        asset,
        open: Number(c.open || 0),
        high: Number(c.high || 0),
        low: Number(c.low || 0),
        close: Number(c.close || 0),
        volume: 0,
        timestamp: Number(c.time || 0),
      }))
      .sort((a, b) => a.timestamp - b.timestamp);
  }

  onCandle(
    asset: string,
    callback: (candle: CandleData) => void,
    size = 60
  ): () => void {
    if (!this.candleListeners.has(asset)) {
      this.candleListeners.set(asset, []);
    }
    this.candleListeners.get(asset)!.push(callback);

    const subKey = `${asset}:${size}`;
    if (!this.activeSubscriptions.has(subKey)) {
      this.activeSubscriptions.set(subKey, { asset, size });
    }

    if (this.authenticated) {
      this.changeSymbol(asset, size);
    }

    return () => {
      const listeners = this.candleListeners.get(asset);
      if (listeners) {
        const idx = listeners.indexOf(callback);
        if (idx >= 0) listeners.splice(idx, 1);
      }
    };
  }

  async placeTrade(request: {
    asset: string;
    direction: "CALL" | "PUT";
    amount: number;
    duration: number;
  }): Promise<TradeResult> {
    if (!this.connected || !this.authenticated) {
      throw new Error("Not connected");
    }

    this.orderData = null;
    this.successOpenOrderFlag = false;

    const action = request.direction === "CALL" ? "call" : "put";
    this.openOrder(request.asset, request.amount, action, this.isDemo ? 1 : 0, request.duration);

    const startTime = Date.now();
    while (Date.now() - startTime < 30000) {
      if (this.orderData !== null && this.successOpenOrderFlag) break;
      await new Promise((r) => setTimeout(r, 100));
    }

    if (!this.orderData) {
      throw new Error("Trade execution timeout");
    }

    const order = this.orderData as Record<string, unknown>;
    const profit = Number(order.profit ?? -request.amount);

    return {
      win: profit > 0,
      profit,
      openPrice: Number(order.open_price || 0),
      closePrice: Number(order.close_price || 0),
      tradeId: String(order.id || ""),
    };
  }

  async getBalance(): Promise<{ demo: number; live: number }> {
    if (this.lastBalance) {
      return this.isDemo
        ? { demo: this.lastBalance.balance, live: 0 }
        : { demo: 0, live: this.lastBalance.balance };
    }
    return { demo: 0, live: 0 };
  }

  async getTradeHistory(): Promise<PocketOptionTrade[]> {
    this.getBalances();
    await new Promise((r) => setTimeout(r, 2000));

    if (!this.closedDealsData.length) return [];

    return this.closedDealsData
      .filter((d): d is Record<string, unknown> => typeof d === "object" && d !== null)
      .map((d) => ({
        id: String(d.id || d.deal_id || ""),
        asset: String(d.asset || d.symbol || ""),
        direction:
          String(d.direction || d.action || "").toLowerCase() === "call"
            ? ("CALL" as const)
            : ("PUT" as const),
        amount: Number(d.amount || 0),
        profit: Number(d.profit || 0),
        openPrice: Number(d.open_price || 0),
        closePrice: Number(d.close_price || 0),
        openTime: Number(d.open_time || 0),
        closeTime: Number(d.close_time || 0),
        result: Number(d.profit || 0) > 0 ? ("WIN" as const) : ("LOSS" as const),
      }));
  }

  // ============ Event Callbacks ============

  onAuth(callback: () => void): () => void {
    this.onAuthCallbacks.push(callback);
    return () => {
      this.onAuthCallbacks = this.onAuthCallbacks.filter((cb) => cb !== callback);
    };
  }

  onBalance(
    callback: (balance: { balance: number; isDemo: number }) => void
  ): () => void {
    this.onBalanceCallbacks.push(callback);
    return () => {
      this.onBalanceCallbacks = this.onBalanceCallbacks.filter((cb) => cb !== callback);
    };
  }

  onError(callback: (error: Error) => void): () => void {
    this.onErrorCallbacks.push(callback);
    return () => {
      this.onErrorCallbacks = this.onErrorCallbacks.filter((cb) => cb !== callback);
    };
  }

  onSsidExpired(callback: () => void): () => void {
    this.onSsidExpiredCallbacks.push(callback);
    return () => {
      this.onSsidExpiredCallbacks = this.onSsidExpiredCallbacks.filter((cb) => cb !== callback);
    };
  }

  // ============ Helpers ============

  private emitCandle(asset: string, candle: CandleData): void {
    const listeners = this.candleListeners.get(asset) || [];
    for (const listener of listeners) {
      try { listener(candle); } catch {}
    }
  }

  private sendEvent(data: unknown): void {
    if (!this.ws || !this.connected) return;
    const message = `42${JSON.stringify(data)}`;
    try {
      this.ws.send(message);
      console.log(`[PO] >> ${message.substring(0, 100)}`);
    } catch (err) {
      console.error("[PO] Send error:", err);
    }
  }

  private startHeartbeats(): void {
    this.cleanup();
    this.socketIoHeartbeat = setInterval(() => {
      if (this.ws && this.connected) {
        this.ws.send('42["ps"]');
      }
    }, 20000);
  }

  private cleanup(): void {
    if (this.socketIoHeartbeat) {
      clearInterval(this.socketIoHeartbeat);
      this.socketIoHeartbeat = null;
    }
  }

  private parseIsDemoFromSsid(): boolean {
    try {
      const match = this.ssid.match(/"isDemo"\s*:\s*(\d)/);
      if (match) return match[1] === "1";
    } catch {}
    return true;
  }
}
