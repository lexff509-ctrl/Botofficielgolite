// PocketOption WebSocket client
// Based on real Socket.IO Engine.IO v4 protocol
// Reference: https://github.com/Mastaaa1987/PocketOptionAPI-v2

import WebSocket from "ws";

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

const WS_URLS = {
  demo: "wss://demo-api-eu.po.market/socket.io/?EIO=4&transport=websocket",
  real: "wss://api-eu.po.market/socket.io/?EIO=4&transport=websocket",
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

  constructor(ssid: string) {
    this.ssid = ssid;
  }

  get isConnected(): boolean {
    return this.connected && this.authenticated;
  }

  get balance(): { balance: number; isDemo: number } | null {
    return this.lastBalance;
  }

  // ============ Connection ============

  async connect(isDemo?: boolean): Promise<void> {
    if (this.connected && this.authenticated) return;

    this.isDemo = isDemo ?? this.parseIsDemoFromSsid();
    this.intentionallyClosed = false;

    const url = this.isDemo ? WS_URLS.demo : WS_URLS.real;

    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(url, { headers: WS_HEADERS });

        const timeout = setTimeout(() => {
          reject(new Error("Connection timeout (15s)"));
          this.ws?.close();
        }, 15000);

        this.ws.on("message", (raw: WebSocket.Data) => {
          try {
            if (Buffer.isBuffer(raw)) {
              this.handleBinaryMessage(raw);
            } else if (typeof raw === "string") {
              this.handleTextMessage(
                raw,
                resolve,
                reject,
                timeout
              );
            } else if (ArrayBuffer.isView(raw) && !(raw instanceof Uint8Array)) {
              this.handleBinaryMessage(Buffer.from(raw as ArrayBuffer));
            } else {
              this.handleTextMessage(
                raw.toString(),
                resolve,
                reject,
                timeout
              );
            }
          } catch (err) {
            console.error("[PO] Message handling error:", err);
          }
        });

        this.ws.on("close", () => {
          this.connected = false;
          this.authenticated = false;
          this.cleanup();

          if (!this.intentionallyClosed) {
            const delay = Math.min(
              5000 * Math.pow(2, this.reconnectAttempts),
              this.maxReconnectDelay
            );
            this.reconnectAttempts++;
            console.log(
              `[PO] Disconnected. Reconnecting in ${delay}ms...`
            );
            setTimeout(() => {
              if (!this.connected && !this.intentionallyClosed) {
                this.connect(this.isDemo).catch(() => {});
              }
            }, delay);
          }
        });

        this.ws.on("error", (err: Error) => {
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
    if (message.startsWith("40") && message.includes("sid")) {
      // Send SSID auth message
      this.ws?.send(this.ssid);
      return;
    }

    // Socket.IO EVENT: "42[...]"
    if (message.startsWith("42")) {
      try {
        const data = JSON.parse(message.substring(2));
        if (Array.isArray(data) && data.length >= 1) {
          if (data[0] === "NotAuthorized") {
            console.error("[PO] NotAuthorized - invalid SSID");
            this.authenticated = false;
            if (timeout) clearTimeout(timeout);
            if (reject)
              reject(new Error("NotAuthorized: SSID invalide"));
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
          this.handleSocketIOEvent(
            data[0],
            data[1],
            resolve,
            timeout
          );
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
    switch (eventName) {
      case "successauth":
        this.authenticated = true;
        this.connected = true;
        this.reconnectAttempts = 0;
        console.log("[PO] Authenticated successfully");

        this.startHeartbeats();

        if (timeout) clearTimeout(timeout);
        if (resolve) resolve();

        // Re-subscribe to previously active symbols
        for (const [, sub] of this.activeSubscriptions) {
          this.sendEvent([
            "changeSymbol",
            { asset: sub.asset, period: sub.size },
          ]);
        }

        this.onAuthCallbacks.forEach((cb) => cb());
        break;

      case "successupdateBalance":
        // Balance update acknowledged
        break;

      case "successopenOrder":
        this.successOpenOrderFlag = true;
        break;

      case "updateClosedDeals":
        this.updateClosedDealsFlag = true;
        break;

      case "successcloseOrder":
        // Order closed
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

      // Balance data: {"balance": ..., "uid": ..., "isDemo": ...}
      if (typeof message === "object" && message !== null && "balance" in message) {
        this.lastBalance = {
          balance: Number(message.balance),
          isDemo: Number(message.isDemo || 0),
        };
        this.onBalanceCallbacks.forEach((cb) => cb(this.lastBalance!));
        return;
      }

      // Order data: {"requestId": "buy", ...}
      if (
        typeof message === "object" &&
        message !== null &&
        "requestId" in message &&
        message.requestId === "buy"
      ) {
        this.orderData = message;
        return;
      }

      // History period data (binary variant): {"data": [...]}
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

      // UpdateStream tick data: [[asset_id, timestamp, price], ...]
      if (this.updateStreamFlag && Array.isArray(message)) {
        this.updateStreamFlag = false;
        // Tick data - we can use server timestamp from this
        if (message.length > 0 && Array.isArray(message[0]) && message[0].length >= 3) {
          console.log("[PO] Received tick data");
        }
        return;
      }

      // Closed deals
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

    // Parse candles: [[time, open, close, high, low], ...]
    const candlesRaw = data.candles;
    if (Array.isArray(candlesRaw) && candlesRaw.length > 0) {
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

    // Parse tick history: [[time, price], ...]
    const historyRaw = data.history;
    if (Array.isArray(historyRaw) && historyRaw.length > 0) {
      console.log(
        `[PO] Received ${historyRaw.length} ticks for ${asset}`
      );
    }
  }

  // ============ Commands ============

  /**
   * Subscribe to real-time data for an asset at a given period
   */
  changeSymbol(asset: string, period: number): void {
    this.currentSymbol = { asset, period };
    const subKey = `${asset}:${period}`;
    this.activeSubscriptions.set(subKey, { asset, size: period });
    this.sendEvent(["changeSymbol", { asset, period }]);
  }

  /**
   * Request historical candle data
   */
  loadHistoryPeriod(
    asset: string,
    period: number,
    endTime: number,
    offset: number
  ): void {
    this.sendEvent([
      "loadHistoryPeriod",
      {
        asset,
        index: endTime,
        time: endTime,
        offset,
        period,
      },
    ]);
  }

  /**
   * Open a trade on PocketOption
   */
  openOrder(
    asset: string,
    amount: number,
    action: "call" | "put",
    isDemo: number,
    time: number
  ): void {
    this.sendEvent([
      "openOrder",
      {
        asset,
        amount,
        action,
        isDemo,
        requestId: "buy",
        optionType: 100,
        time,
      },
    ]);
  }

  /**
   * Request account balance
   */
  getBalances(): void {
    this.sendEvent({ name: "get-balances", version: "1.0" });
  }

  // ============ Async Request Methods ============

  /**
   * Get historical candle data (waits for response)
   */
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

    // Wait for response (up to 10 seconds)
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

  /**
   * Subscribe to real-time candle updates
   */
  onCandle(
    asset: string,
    callback: (candle: CandleData) => void,
    size = 60
  ): () => void {
    if (!this.candleListeners.has(asset)) {
      this.candleListeners.set(asset, []);
    }
    this.candleListeners.get(asset)!.push(callback);

    // Track subscription
    const subKey = `${asset}:${size}`;
    if (!this.activeSubscriptions.has(subKey)) {
      this.activeSubscriptions.set(subKey, { asset, size });
    }

    // Subscribe via changeSymbol
    if (this.authenticated) {
      this.changeSymbol(asset, size);
    }

    // Return unsubscribe function
    return () => {
      const listeners = this.candleListeners.get(asset);
      if (listeners) {
        const idx = listeners.indexOf(callback);
        if (idx >= 0) listeners.splice(idx, 1);
      }
    };
  }

  /**
   * Place a trade and wait for result
   */
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
    this.openOrder(
      request.asset,
      request.amount,
      action,
      this.isDemo ? 1 : 0,
      request.duration
    );

    // Wait for response (up to 30 seconds)
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

  /**
   * Get current balance
   */
  async getBalance(): Promise<{ demo: number; live: number }> {
    if (this.lastBalance) {
      return this.isDemo
        ? { demo: this.lastBalance.balance, live: 0 }
        : { demo: 0, live: this.lastBalance.balance };
    }
    return { demo: 0, live: 0 };
  }

  /**
   * Get trade history (from closed deals)
   */
  async getTradeHistory(): Promise<PocketOptionTrade[]> {
    // Request balance update to trigger closed deals
    this.getBalances();

    // Wait briefly for data
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
      this.onAuthCallbacks = this.onAuthCallbacks.filter(
        (cb) => cb !== callback
      );
    };
  }

  onBalance(
    callback: (balance: { balance: number; isDemo: number }) => void
  ): () => void {
    this.onBalanceCallbacks.push(callback);
    return () => {
      this.onBalanceCallbacks = this.onBalanceCallbacks.filter(
        (cb) => cb !== callback
      );
    };
  }

  onError(callback: (error: Error) => void): () => void {
    this.onErrorCallbacks.push(callback);
    return () => {
      this.onErrorCallbacks = this.onErrorCallbacks.filter(
        (cb) => cb !== callback
      );
    };
  }

  // ============ Helpers ============

  private emitCandle(asset: string, candle: CandleData): void {
    const listeners = this.candleListeners.get(asset) || [];
    for (const listener of listeners) {
      try {
        listener(candle);
      } catch {}
    }
  }

  private sendEvent(data: unknown): void {
    if (!this.ws || !this.connected) return;
    const message = `42${JSON.stringify(data)}`;
    try {
      this.ws.send(message);
    } catch (err) {
      console.error("[PO] Send error:", err);
    }
  }

  private startHeartbeats(): void {
    this.cleanup();
    // Socket.IO heartbeat: send 42["ps"] every 20 seconds
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
    return true; // Default to demo for safety
  }
}
