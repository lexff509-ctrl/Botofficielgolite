// PocketOption WebSocket client
// Based on real Socket.IO Engine.IO v4 protocol
// Reference: https://github.com/Mastaaa1987/PocketOptionAPI-v2
//
// Connection flow (direct WebSocket - like Python reference client):
// 1. Connect wss://host/socket.io/?EIO=4&transport=websocket
// 2. Server sends "0{...}" (Engine.IO OPEN) → client sends "40" (Socket.IO CONNECT)
// 3. Server sends "40{sid:...}" → client sends 42["auth",...] (SSID)
// 4. Server sends 451-["successauth",...] → authenticated!
//
// Fallback: Engine.IO v4 HTTP polling upgrade flow:
// 1. GET /socket.io/?EIO=4&transport=polling → get sid + cookies
// 2. POST /socket.io/?EIO=4&transport=polling&sid=xxx body "40" (Socket.IO CONNECT)
// 3. GET /socket.io/?EIO=4&transport=polling&sid=xxx → read CONNECT ACK
// 4. WebSocket connect wss://host/socket.io/?EIO=4&transport=websocket&sid=xxx
// 5. Send "2probe" → wait for "3probe" → send "5" (upgrade complete)
// 6. Send auth 42["auth",...]

import WebSocket from "ws";
import https from "https";
import {
  WS_HEADERS as CONN_WS_HEADERS,
  HTTP_HEADERS as CONN_HTTP_HEADERS,
  preFetchCookies,
  getReconnectDelay,
  getTradeJitter,
  getBestHost,
  discoverReachableHosts,
  PO_REGIONS,
} from "./connection";

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

// Legacy - kept for reference, but actual hosts are now auto-discovered
const LEGACY_HOSTS = {
  demo: "demo-api-eu.po.market",
  real: "api-eu.po.market",
};

// ============ Client ============

export class PocketOptionClient {
  private ssid: string; // Full 42["auth",...] message
  private ws: WebSocket | null = null;
  private connected = false;
  private authenticated = false;
  private isDemo = true;

  // Connection state
  private isUpgradeConnection = false; // true when using HTTP polling → WS upgrade
  private upgradeResolve: ((value: void) => void) | null = null;
  private upgradeReject: ((error: Error) => void) | null = null;
  private connectionTimeout: ReturnType<typeof setTimeout> | null = null;

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

  // Binary attachment tracking: when a 451- event has _placeholder,
  // the actual data arrives in the next binary WebSocket frame
  private pendingBinaryEvent: string | null = null;
  private pendingBinaryEventData: unknown = null;

  // Cached response data
  private historyPeriodData: Record<string, unknown> | null = null;
  private orderData: Record<string, unknown> | null = null;
  private historyNewData: Record<string, unknown> | null = null;
  private closedDealsData: unknown[] = [];
  private lastBalance: { balance: number; isDemo: number } | null = null;
  private assetData: Record<string, { payout: number }> = {};

  // Heartbeat
  private socketIoHeartbeat: ReturnType<typeof setInterval> | null = null;

  // Reconnection
  private reconnectAttempts = 0;
  private maxReconnectDelay = 60000;
  private intentionallyClosed = false;

  // SSID expiration tracking
  private ssidExpired = false;
  // Mutex for sequential trade execution per client
  private tradeMutex: Promise<void> = Promise.resolve();
  // Pre-fetched cookies for anti-detection
  private prefetchedCookies: string[] = [];
  // Tick counter for throttled logging
  private tickCount = 0;

  constructor(ssid: string, cookies?: string[]) {
    this.ssid = ssid;
    if (cookies) this.prefetchedCookies = cookies;
  }

  get isConnected(): boolean {
    // A client is only truly connected if the WebSocket is open AND it's authenticated
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN && this.connected && this.authenticated;
  }

  get isSsidExpired(): boolean {
    return this.ssidExpired;
  }

  get balance(): { balance: number; isDemo: number } | null {
    return this.lastBalance;
  }

  get assets(): Record<string, { payout: number }> {
    return this.assetData;
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
    this.isUpgradeConnection = false;

    // Auto-discover reachable hosts
    let reachableHosts = await discoverReachableHosts(this.isDemo);

    if (reachableHosts.length === 0) {
      // Fallback to legacy host if discovery fails
      const fallback = this.isDemo ? LEGACY_HOSTS.demo : LEGACY_HOSTS.real;
      console.log(`[PO] No reachable hosts discovered, trying fallback: ${fallback}`);
      reachableHosts = [fallback];
    }

    // Try each reachable host with both strategies
    // NotAuthorized from a non-matching host (e.g., live host for demo SSID) is NOT
    // a true expiration - it just means wrong server. Only treat as expired if
    // we get NotAuthorized from a host that matches the SSID type.
    let gotNotAuthorizedOnMatchingHost = false;

    for (const host of reachableHosts) {
      console.log(`[PO] Trying host: ${host}`);
      // Reset ssidExpired for each host attempt - it may have been set
      // by a non-matching host (e.g., live server rejecting demo SSID)
      this.ssidExpired = false;

      // Strategy 1: Direct WebSocket (like the Python reference client)
      try {
        await this.connectDirect(host);
        return; // Success!
      } catch (directErr) {
        const errMsg = directErr instanceof Error ? directErr.message : String(directErr);
        console.log(`[PO] Direct WebSocket failed on ${host}: ${errMsg}`);

        if (this.ssidExpired) {
          // Check if this host matches the SSID type (demo/demo or live/live)
          const isDemoHost = host.includes("demo") || host.includes("try-demo");
          if (isDemoHost === this.isDemo) {
            // NotAuthorized on matching host = truly expired
            gotNotAuthorizedOnMatchingHost = true;
            break;
          }
          // NotAuthorized on non-matching host = wrong server, skip it
          console.log(`[PO] NotAuthorized on non-matching host ${host} (demo=${isDemoHost}, ssid demo=${this.isDemo}), trying next host...`);
          this.ssidExpired = false;
        }
      }

      // Strategy 2: Full Engine.IO v4 polling → WebSocket upgrade
      try {
        await this.connectWithUpgrade(host);
        return; // Success!
      } catch (upgradeErr) {
        const errMsg = upgradeErr instanceof Error ? upgradeErr.message : String(upgradeErr);
        console.log(`[PO] Upgrade failed on ${host}: ${errMsg}`);

        if (this.ssidExpired) {
          const isDemoHost = host.includes("demo") || host.includes("try-demo");
          if (isDemoHost === this.isDemo) {
            gotNotAuthorizedOnMatchingHost = true;
            break;
          }
          console.log(`[PO] NotAuthorized on non-matching host ${host}, trying next host...`);
          this.ssidExpired = false;
        }
      }
    }

    if (gotNotAuthorizedOnMatchingHost) {
      throw new Error("SSID expiré ou invalide (NotAuthorized)");
    }

    throw new Error(`Failed to connect: all ${reachableHosts.length} hosts failed. Check network or SSID.`);
  }

  /** Strategy 1: Direct WebSocket connection (Python reference client approach) */
  private connectDirect(host: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const wsUrl = `wss://${host}/socket.io/?EIO=4&transport=websocket`;
      console.log(`[PO] Direct WebSocket to ${host}...`);

      try {
        const wsHeaders: Record<string, string> = {
          ...CONN_WS_HEADERS,
          Host: host,
        };
        if (this.prefetchedCookies.length > 0) {
          wsHeaders["Cookie"] = this.prefetchedCookies.join("; ");
        }

        this.ws = new WebSocket(wsUrl, {
          headers: wsHeaders,
          handshakeTimeout: 10000,
        } as WebSocket.ClientOptions);

        this.upgradeResolve = resolve;
        this.upgradeReject = reject;

        this.connectionTimeout = setTimeout(() => {
          reject(new Error("Connection timeout (10s) - possible firewall/anti-bot block"));
          this.ws?.close();
        }, 10000);

        this.ws.on("open", () => {
          console.log("[PO] WebSocket connected, waiting for Engine.IO OPEN...");
        });

        this.ws.on("message", (raw: WebSocket.Data) => {
          this.handleRawMessage(raw);
        });

        this.ws.on("close", (code: number, reason: Buffer) => {
          console.log(`[PO] WebSocket closed. Code: ${code}, Reason: ${reason.toString()}`);
          this.handleDisconnect();
        });

        this.ws.on("error", (err: Error) => {
          console.error(`[PO] WebSocket error: ${err.message}`);
          if (this.connectionTimeout) clearTimeout(this.connectionTimeout);
          this.handleDisconnect();
          reject(err);
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  /** Strategy 2: Engine.IO v4 HTTP polling → WebSocket upgrade */
  private async connectWithUpgrade(host: string): Promise<void> {
    // Step 1: HTTP GET polling → get sid + cookies
    const { sid, cookies } = await this.httpPollingOpen(host);
    if (!sid) {
      throw new Error("Failed to get sid from HTTP polling handshake");
    }
    console.log(`[PO] Got sid from polling: ${sid}`);

    // Step 2: HTTP POST polling with Socket.IO CONNECT (40)
    await this.httpPollingPost(host, sid, "40", cookies);

    // Step 3: HTTP GET polling to read CONNECT ACK
    await this.httpPollingRead(host, sid, cookies);

    // Step 4: WebSocket upgrade with sid + cookies
    this.isUpgradeConnection = true;
    return new Promise((resolve, reject) => {
      const wsUrl = `wss://${host}/socket.io/?EIO=4&transport=websocket&sid=${encodeURIComponent(sid)}`;
      console.log(`[PO] WebSocket upgrade to ${host}...`);

      try {
        // Merge pre-fetched cookies with polling cookies for best detection avoidance
        const allCookies = [...this.prefetchedCookies, ...cookies];
        const wsOptions: WebSocket.ClientOptions = {
          headers: {
            ...CONN_WS_HEADERS,
            Host: host,
            ...(allCookies.length > 0 ? { Cookie: allCookies.join("; ") } : {}),
          },
          handshakeTimeout: 10000,
        };

        this.ws = new WebSocket(wsUrl, wsOptions);
        this.upgradeResolve = resolve;
        this.upgradeReject = reject;

        this.connectionTimeout = setTimeout(() => {
          reject(new Error("Upgrade timeout (10s) - server may be blocking this IP"));
          this.ws?.close();
        }, 10000);

        this.ws.on("open", () => {
          // Engine.IO v4 upgrade probe sequence
          console.log("[PO] WebSocket connected, sending probe...");
          this.ws?.send("2probe");
        });

        this.ws.on("message", (raw: WebSocket.Data) => {
          this.handleRawMessage(raw);
        });

        this.ws.on("close", (code: number, reason: Buffer) => {
          console.log(`[PO] WebSocket closed. Code: ${code}, Reason: ${reason.toString()}`);
          this.handleDisconnect();
        });

        this.ws.on("error", (err: Error) => {
          console.error(`[PO] Upgrade error: ${err.message}`);
          if (this.connectionTimeout) clearTimeout(this.connectionTimeout);
          this.handleDisconnect();
          reject(err);
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  // ============ HTTP Polling Methods ============

  /** HTTP GET polling - Engine.IO OPEN handshake */
  private httpPollingOpen(host: string): Promise<{ sid: string; cookies: string[] }> {
    return new Promise((resolve, reject) => {
      console.log(`[PO] HTTP polling handshake to ${host}...`);

      const req = https.get({
        hostname: host,
        path: "/socket.io/?EIO=4&transport=polling",
        method: "GET",
        headers: {
          ...CONN_HTTP_HEADERS,
          Host: host,
          Accept: "*/*",
          ...(this.prefetchedCookies.length > 0 ? { Cookie: this.prefetchedCookies.join("; ") } : {}),
        },
      }, (res) => {
        const cookies = (res.headers["set-cookie"] || []).map(
          (c: string) => c.split(";")[0]
        );

        let body = "";
        res.on("data", (chunk: Buffer) => { body += chunk.toString(); });
        res.on("end", () => {
          try {
            console.log(`[PO] Polling response: ${body.substring(0, 200)}`);
            // Response format: "0{"sid":"xxx","upgrades":["websocket"],...}"
            if (body.startsWith("0")) {
              const jsonStr = body.substring(1);
              const parsed = JSON.parse(jsonStr);
              resolve({ sid: parsed.sid || "", cookies });
            } else {
              // Try regex fallback
              const match = body.match(/"sid"\s*:\s*"([^"]+)"/);
              resolve({ sid: match ? match[1] : "", cookies });
            }
          } catch (err) {
            console.error("[PO] Polling parse error:", err);
            resolve({ sid: "", cookies });
          }
        });
      });

      req.on("error", (err: Error) => {
        console.error(`[PO] HTTP polling error: ${err.message}`);
        reject(new Error(`HTTP polling failed: ${err.message}`));
      });

      req.setTimeout(10000, () => {
        req.destroy();
        reject(new Error("HTTP polling timeout"));
      });
    });
  }

  /** HTTP POST polling - send data via polling transport */
  private httpPollingPost(
    host: string,
    sid: string,
    body: string,
    cookies: string[]
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const path = `/socket.io/?EIO=4&transport=polling&sid=${encodeURIComponent(sid)}`;
      const bodyBuf = Buffer.from(body, "utf8");

      const options: https.RequestOptions = {
        hostname: host,
        path,
        method: "POST",
        headers: {
          ...CONN_HTTP_HEADERS,
          Host: host,
          "Content-Type": "text/plain; charset=UTF-8",
          "Content-Length": bodyBuf.length,
          ...(cookies.length > 0 ? { Cookie: cookies.join("; ") } : {}),
          ...(this.prefetchedCookies.length > 0 ? { Cookie: [...this.prefetchedCookies, ...cookies].join("; ") } : {}),
        },
      };

      const req = https.request(options, (res) => {
        let data = "";
        res.on("data", (chunk: Buffer) => { data += chunk.toString(); });
        res.on("end", () => {
          console.log(`[PO] POST response: ${data.substring(0, 100)} (status: ${res.statusCode})`);
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            resolve();
          } else {
            reject(new Error(`POST polling returned ${res.statusCode}`));
          }
        });
      });

      req.on("error", (err: Error) => {
        reject(new Error(`POST polling failed: ${err.message}`));
      });

      req.setTimeout(10000, () => {
        req.destroy();
        reject(new Error("POST polling timeout"));
      });

      req.write(bodyBuf);
      req.end();
    });
  }

  /** HTTP GET polling - read data from polling transport */
  private httpPollingRead(
    host: string,
    sid: string,
    cookies: string[]
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const path = `/socket.io/?EIO=4&transport=polling&sid=${encodeURIComponent(sid)}`;

      const options: https.RequestOptions = {
        hostname: host,
        path,
        method: "GET",
        headers: {
          ...CONN_HTTP_HEADERS,
          Host: host,
          Accept: "*/*",
          ...(this.prefetchedCookies.length > 0 ? { Cookie: [...this.prefetchedCookies, ...cookies].join("; ") } : (cookies.length > 0 ? { Cookie: cookies.join("; ") } : {})),
        },
      };

      const req = https.request(options, (res) => {
        let data = "";
        res.on("data", (chunk: Buffer) => { data += chunk.toString(); });
        res.on("end", () => {
          console.log(`[PO] GET polling data: ${data.substring(0, 200)}`);
          resolve(data);
        });
      });

      req.on("error", (err: Error) => {
        reject(new Error(`GET polling failed: ${err.message}`));
      });

      req.setTimeout(10000, () => {
        req.destroy();
        reject(new Error("GET polling timeout"));
      });

      req.end();
    });
  }

  // ============ Message Routing ============

  private handleRawMessage(raw: WebSocket.Data): void {
    try {
      // PocketOption server may send text protocol messages as binary Buffers.
      let text: string;
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
        firstChar === "1" || // Engine.IO CLOSE
        firstChar === "2" || // Engine.IO PING
        firstChar === "3" || // Engine.IO PONG
        firstChar === "4" || // Socket.IO (40, 42, 451-)
        firstChar === "5" || // Engine.IO UPGRADE
        firstChar === "6"    // Engine.IO NOOP
      ) {
        this.handleTextMessage(text);
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
  }

  // ============ Text Message Handler ============

  private handleTextMessage(message: string): void {
    console.log(`[PO] << ${message.substring(0, 150)}`);

    // Engine.IO OPEN: "0{sid:...}"
    if (message.startsWith("0")) {
      console.log("[PO] Engine.IO OPEN received, sending Socket.IO CONNECT...");
      this.ws?.send("40"); // Socket.IO CONNECT
      return;
    }

    // Engine.IO CLOSE: "1"
    if (message.startsWith("1")) {
      console.log("[PO] Engine.IO CLOSE received");
      this.ws?.close();
      return;
    }

    // Engine.IO PING: "2"
    if (message === "2") {
      this.ws?.send("3"); // Engine.IO PONG
      return;
    }

    // Engine.IO PONG with probe: "3probe"
    if (message === "3probe") {
      console.log("[PO] Probe ACK received, sending upgrade complete...");
      this.ws?.send("5"); // Engine.IO UPGRADE COMPLETE
      // After upgrade, send Socket.IO CONNECT if not already sent via polling
      if (!this.isUpgradeConnection) {
        // Direct connection: CONNECT already sent after OPEN
      } else {
        // Upgrade connection: Socket.IO CONNECT was sent via polling,
        // but we need to re-send via WebSocket to establish namespace
        console.log("[PO] Sending Socket.IO CONNECT via WebSocket...");
        this.ws?.send("40");
      }
      return;
    }

    // Engine.IO PONG: "3"
    if (message === "3") {
      return; // Regular pong, nothing to do
    }

    // Engine.IO NOOP: "6" (sent by server to close active polling GET requests)
    if (message === "6") {
      return;
    }

    // Socket.IO CONNECT ACK: "40{sid:...}"
    if (message.startsWith("40")) {
      console.log("[PO] Socket.IO CONNECT ACK received, sending auth...");
      // Auto-wrap SSID if it's just the token
      const authMessage = this.ssid.startsWith('42["auth"') 
        ? this.ssid 
        : `42["auth","${this.ssid}"]`;
      this.ws?.send(authMessage);
      return;
    }

    // Socket.IO EVENT: "42[...]"
    if (message.startsWith("42")) {
      try {
        const data = JSON.parse(message.substring(2));
        if (Array.isArray(data) && data.length >= 1) {
          const eventName = data[0];

          if (eventName === "NotAuthorized") {
            console.error("[PO] NotAuthorized - SSID expired or invalid");
            this.ssidExpired = true;
            this.intentionallyClosed = true;
            this.authenticated = false;
            this.onSsidExpiredCallbacks.forEach((cb) => {
              try { cb(); } catch {}
            });
            if (this.connectionTimeout) clearTimeout(this.connectionTimeout);
            if (this.upgradeReject) this.upgradeReject(new Error("NotAuthorized: SSID invalide"));
            this.ws?.close();
            return;
          }

          // Handle other Socket.IO events inline
          this.handleSocketIOEvent(eventName, data[1]);
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
          const eventName = data[0];
          const eventData = data[1];

          // Check if this event has a binary placeholder (_placeholder: true)
          // The actual data will arrive in the next binary WebSocket frame
          if (eventData && typeof eventData === "object" && (eventData as Record<string, unknown>)._placeholder) {
            console.log(`[PO] Binary event pending: ${eventName} (waiting for binary attachment)`);
            this.pendingBinaryEvent = eventName;
            this.pendingBinaryEventData = null;
          } else {
            // No placeholder - process immediately
            this.handleSocketIOEvent(eventName, eventData);
          }
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
    eventData: unknown
  ): void {
    console.log(`[PO] Event: ${eventName}`);

    switch (eventName) {
      case "successauth":
        this.authenticated = true;
        this.connected = true;
        this.reconnectAttempts = 0;
        console.log("[PO] Authenticated successfully!");

        this.startHeartbeats();

        if (this.connectionTimeout) clearTimeout(this.connectionTimeout);
        if (this.upgradeResolve) this.upgradeResolve();

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
            this.pendingBinaryEvent = "successopenOrder";
            console.log("[PO] Order request accepted, waiting for confirmation data...");
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

  // ============ Disconnect Handler ============

  private handleDisconnect(): void {
    this.connected = false;
    this.authenticated = false;
    this.isUpgradeConnection = false;
    this.upgradeResolve = null;
    this.upgradeReject = null;
    if (this.connectionTimeout) {
      clearTimeout(this.connectionTimeout);
      this.connectionTimeout = null;
    }
    this.cleanup();

    if (!this.intentionallyClosed) {
      const delay = getReconnectDelay(this.reconnectAttempts, this.maxReconnectDelay);
      this.reconnectAttempts++;
      console.log(`[PO] Disconnected. Reconnecting in ${Math.round(delay)}ms (attempt ${this.reconnectAttempts})...`);
      setTimeout(() => {
        if (!this.connected && !this.intentionallyClosed) {
          this.connect(this.isDemo).catch((err) => {
            console.error(`[PO] Reconnection failed: ${err.message}`);
          });
        }
      }, delay);
    }
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
    this.upgradeResolve = null;
    this.upgradeReject = null;
    if (this.connectionTimeout) {
      clearTimeout(this.connectionTimeout);
      this.connectionTimeout = null;
    }
  }

  // ============ Binary Message Handler ============

  private handleBinaryMessage(buffer: Buffer): void {
    try {
      // First try to parse as regular UTF-8 JSON (PocketOption often wraps JSON in binary)
      const raw = buffer.toString("utf8");
      let message: unknown;
      
      // If it's a binary attachment (not raw JSON), it might be msgpack or similar
      // but PocketOption usually uses JSON even in binary frames
      try {
        message = JSON.parse(raw);
      } catch {
        // If not JSON, it could be a raw binary stream of ticks or balance
        // Handle specific binary formats if known, otherwise log for debug
        if (buffer.length === 8) {
          // Possible 64-bit float balance update
          const bal = buffer.readDoubleLE(0);
          if (bal > 0 && bal < 10000000) {
            console.log(`[PO] Detected raw binary balance: ${bal}`);
            this.lastBalance = { balance: bal, isDemo: this.isDemo ? 1 : 0 };
            this.onBalanceCallbacks.forEach(cb => cb(this.lastBalance!));
          }
        }
        return;
      }

      // If we have a pending binary event from a 451- placeholder,
      // match this binary data with that event
      if (this.pendingBinaryEvent) {
        const eventName = this.pendingBinaryEvent;
        this.pendingBinaryEvent = null;
        console.log(`[PO] Binary attachment for event: ${eventName}`);

        switch (eventName) {
          case "loadHistoryPeriod":
          case "loadHistoryPeriodFast":
            if (typeof message === "object" && message !== null && "data" in (message as Record<string, unknown>)) {
              const msg = message as Record<string, unknown>;
              this.loadHistoryPeriodFlag = true;
              this.historyPeriodData = msg;
              const dataArr = msg.data;
              console.log(`[PO] History period data: ${Array.isArray(dataArr) ? dataArr.length + ' candles' : 'received'}`);
            }
            return;

          case "updateHistoryNew":
          case "updateHistoryNewFast":
            if (typeof message === "object" && message !== null) {
              this.historyNewData = message as Record<string, unknown>;
              this.processHistoryNew(message as Record<string, unknown>);
            }
            return;

          case "updateClosedDeals":
            if (Array.isArray(message)) {
              this.updateClosedDealsFlag = true;
              this.closedDealsData = message;
            }
            return;

          case "updateStream":
            if (Array.isArray(message)) {
              this.processStreamTick(message);
            }
            return;

          case "updateAssets":
            console.log("[PO] Assets data received (binary)");
            if (Array.isArray(message)) {
              for (const asset of message) {
                if (asset && typeof asset === "object" && asset.symbol && asset.payout) {
                  this.assetData[asset.symbol] = { payout: Number(asset.payout) / 100 };
                }
              }
            }
            return;

          case "updateCharts":
            console.log("[PO] Charts update received (binary)");
            return;

          case "updateOpenedDeals":
            console.log("[PO] Opened deals update received (binary)");
            return;

          case "successauth":
            // Authentication successful - the binary data may contain user info/balance
            console.log("[PO] Auth success binary data received");
            if (typeof message === "object" && message !== null) {
              const msg = message as Record<string, any>;
              if (msg.balance !== undefined) {
                this.lastBalance = {
                  balance: Number(msg.balance),
                  isDemo: Number(msg.isDemo !== undefined ? msg.isDemo : (this.isDemo ? 1 : 0)),
                };
                console.log(`[PO] Balance updated from auth: ${this.lastBalance.balance}`);
                this.onBalanceCallbacks.forEach((cb) => cb(this.lastBalance!));
              }
            }
            // Now trigger the auth success handler
            this.handleSocketIOEvent("successauth", message);
            return;

          case "successupdateBalance":
          case "successupdatePending":
            if (typeof message === "object" && message !== null) {
              const msg = message as Record<string, any>;
              if (msg.balance !== undefined) {
                this.lastBalance = {
                  balance: Number(msg.balance),
                  isDemo: Number(msg.isDemo !== undefined ? msg.isDemo : (this.isDemo ? 1 : 0)),
                };
                console.log(`[PO] Balance updated from event: ${this.lastBalance.balance}`);
                this.onBalanceCallbacks.forEach((cb) => cb(this.lastBalance!));
              }
            }
            return;

          default:
            console.log(`[PO] Unhandled binary event: ${eventName}`);
            return;
        }
      }

      // No pending binary event - handle as standalone binary data
      if (typeof message === "object" && message !== null) {
        const msg = message as Record<string, any>;
        if (msg.balance !== undefined) {
          this.lastBalance = {
            balance: Number(msg.balance),
            isDemo: Number(msg.isDemo !== undefined ? msg.isDemo : (this.isDemo ? 1 : 0)),
          };
          this.onBalanceCallbacks.forEach((cb) => cb(this.lastBalance!));
          return;
        }
      }

      if (
        this.pendingBinaryEvent === "successopenOrder" ||
        (typeof message === "object" &&
        message !== null &&
        "requestId" in (message as Record<string, unknown>))
      ) {
        this.orderData = message as Record<string, unknown>;
        return;
      }

      if (
        this.loadHistoryPeriodFlag &&
        typeof message === "object" &&
        message !== null &&
        "data" in (message as Record<string, unknown>)
      ) {
        this.loadHistoryPeriodFlag = false;
        this.historyPeriodData = message as Record<string, unknown>;
        return;
      }

      if (this.updateStreamFlag && Array.isArray(message)) {
        this.updateStreamFlag = false;
        this.processStreamTick(message);
        return;
      }

      if (this.updateClosedDealsFlag && Array.isArray(message)) {
        this.updateClosedDealsFlag = false;
        this.closedDealsData = message;
        return;
      }
    } catch (err) {
      // Ignore parse errors for non-JSON binary frames
    }
  }

  // ============ History New Processing ============

  private processHistoryNew(data: Record<string, unknown>): void {
    const asset = this.currentSymbol?.asset;
    if (!asset) return;

    // Handle binary data with "data" field (from loadHistoryPeriod binary attachment)
    if ("data" in data && Array.isArray(data.data)) {
      const dataArr = data.data as unknown[];
      console.log(`[PO] History data: ${dataArr.length} items for ${asset}`);

      // Format: array of objects with {time, open, high, low, close}
      for (const item of dataArr) {
        if (typeof item === "object" && item !== null && "time" in (item as Record<string, unknown>)) {
          const c = item as Record<string, unknown>;
          const candle: CandleData = {
            asset,
            open: Number(c.open || 0),
            close: Number(c.close || 0),
            high: Number(c.high || 0),
            low: Number(c.low || 0),
            volume: 0,
            timestamp: Number(c.time || 0),
          };
          if (candle.timestamp > 0 && candle.close > 0) {
            this.emitCandle(asset, candle);
          }
        }
      }
    }

    // Handle "candles" field (from updateHistoryNew binary attachment)
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
          if (candle.timestamp > 0 && candle.close > 0) {
            this.emitCandle(asset, candle);
          }
        }
      }
    }

    const historyRaw = data.history;
    if (Array.isArray(historyRaw) && historyRaw.length > 0) {
      console.log(`[PO] Received ${historyRaw.length} ticks for ${asset}`);
    }
  }

  // ============ Stream Tick Processing ============

  /** Process real-time tick data from updateStream to update the current candle */
  private processStreamTick(message: unknown[]): void {
    const asset = this.currentSymbol?.asset;
    if (!asset || !this.authenticated) return;

    this.tickCount++;
    if (this.tickCount % 100 === 0) {
      console.log(`[PO] Stream: ${this.tickCount} ticks processed for ${asset}`);
    }

    // updateStream data format: array of [timestamp, quote_id, price] or [timestamp, price]
    for (const entry of message) {
      if (!Array.isArray(entry)) continue;

      let timestamp: number;
      let price: number;

      if (entry.length >= 3) {
        // Format: [timestamp, quote_id, price]
        timestamp = Number(entry[0]);
        price = Number(entry[2]);
      } else if (entry.length >= 2) {
        // Format: [timestamp, price]
        timestamp = Number(entry[0]);
        price = Number(entry[1]);
      } else {
        continue;
      }

      if (price <= 0 || timestamp <= 0) continue;

      // Emit a real-time candle update for the current forming candle
      // The cache will merge this with the existing last candle
      const candle: CandleData = {
        asset,
        open: price,   // Will be overridden by cache merge if candle exists
        high: price,
        low: price,
        close: price,
        volume: 0,
        timestamp,
      };
      this.emitCandle(asset, candle);
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
    const poAsset = PocketOptionClient.toPOSymbol(asset);
    console.log(`[PO] Sending openOrder: ${poAsset} $${amount} ${action} (demo=${isDemo}, time=${time})`);
    
    // Ensure data types are correct for the PocketOption protocol
    const orderData = {
      asset: poAsset,
      amount: Number(amount),
      action: action.toLowerCase(),
      isDemo: Number(isDemo),
      requestId: Date.now(), // Unique request ID
      optionType: 100, // Fixed for digital options
      time: Number(time),
    };

    this.sendEvent(["openOrder", orderData]);
  }

  getBalances(): void {
    this.sendEvent({ name: "get-balances", version: "1.0" });
  }

  // ============ Async Request Methods ============

  /**
   * Fetch historical candles by subscribing to the asset and waiting for
   * updateHistoryNew data. Falls back to loadHistoryPeriod if needed.
   */
  async requestCandleHistory(
    asset: string,
    period: number,
    count: number
  ): Promise<CandleData[]> {
    if (!this.connected || !this.authenticated) return [];

    // Reset state
    this.historyPeriodData = null;
    this.historyNewData = null;
    this.loadHistoryPeriodFlag = false;

    const poAsset = PocketOptionClient.toPOSymbol(asset);

    // Strategy 1: Subscribe via changeSymbol and wait for updateHistoryNew
    // This typically provides the most complete candle history
    if (this.currentSymbol?.asset !== asset || this.currentSymbol?.period !== period) {
      this.changeSymbol(asset, period);
    } else {
      // Already watching, but force a refresh if we need history
      this.sendEvent(["changeSymbol", { asset: poAsset, period }]);
    }

    // Wait for updateHistoryNew/Fast binary data to arrive (max 3 seconds)
    for (let i = 0; i < 30; i++) {
      if (this.historyNewData !== null) break;
      await new Promise((r) => setTimeout(r, 100));
    }

    // Check if we got candle data from the subscription
    if (this.historyNewData) {
      const candles = this.parseCandleData(asset, this.historyNewData);
      if (candles.length >= 10) {
        console.log(`[PO] Got ${candles.length} candles from subscription for ${asset}`);
        return candles;
      }
    }

    // Strategy 2: Try loadHistoryPeriod for additional data
    this.historyPeriodData = null;
    this.loadHistoryPeriodFlag = false;

    const endTime = Math.floor(Date.now() / 1000);
    this.sendEvent([
      "loadHistoryPeriod",
      { asset: poAsset, index: endTime, time: endTime, offset: count, period },
    ]);

    for (let i = 0; i < 50; i++) {
      if (this.historyPeriodData !== null) break;
      await new Promise((r) => setTimeout(r, 100));
    }

    if (this.historyPeriodData) {
      const candles = this.parseCandleData(asset, this.historyPeriodData);
      if (candles.length > 0) {
        console.log(`[PO] Got ${candles.length} candles from loadHistoryPeriod for ${asset}`);
        return candles;
      }
    }

    // Strategy 3: Try with different offset values
    // Sometimes the server needs a specific time range
    for (const offsetMult of [1, 5, 10]) {
      this.historyPeriodData = null;
      this.loadHistoryPeriodFlag = false;

      const offsetTime = endTime - (count * period * offsetMult);
      this.sendEvent([
        "loadHistoryPeriod",
        { asset: poAsset, index: offsetTime, time: offsetTime, offset: count, period },
      ]);

      for (let i = 0; i < 30; i++) {
        if (this.historyPeriodData !== null) break;
        await new Promise((r) => setTimeout(r, 100));
      }

      if (this.historyPeriodData) {
        const candles = this.parseCandleData(asset, this.historyPeriodData);
        if (candles.length > 0) {
          console.log(`[PO] Got ${candles.length} candles from loadHistoryPeriod (offset=${offsetMult}) for ${asset}`);
          return candles;
        }
      }
    }

    console.log(`[PO] Could not get candle history for ${asset}`);
    return [];
  }

  /** Parse candle data from server response (both historyPeriod and historyNew formats) */
  private parseCandleData(asset: string, data: Record<string, unknown>): CandleData[] {
    const dataArr = data.data;
    if (Array.isArray(dataArr) && dataArr.length > 0) {
      // Format 1: array of objects with {time, open, high, low, close}
      if (typeof dataArr[0] === "object" && dataArr[0] !== null && "time" in (dataArr[0] as Record<string, unknown>)) {
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
          .filter((c: CandleData) => c.timestamp > 0 && c.close > 0)
          .sort((a: CandleData, b: CandleData) => a.timestamp - b.timestamp);
      }

      // Format 2: array of arrays [[time, open, close, high, low, volume], ...]
      if (Array.isArray(dataArr[0])) {
        return dataArr
          .map((c: unknown[]) => {
            if (Array.isArray(c) && c.length >= 5) {
              return {
                asset,
                open: Number(c[1] || 0),
                close: Number(c[2] || 0),
                high: Number(c[3] || 0),
                low: Number(c[4] || 0),
                volume: Number(c[5] || 0),
                timestamp: Number(c[0] || 0),
              };
            }
            return null;
          })
          .filter((c): c is CandleData => c !== null && c.timestamp > 0 && c.close > 0)
          .sort((a, b) => a.timestamp - b.timestamp);
      }
    }

    // Format 3: candles field from updateHistoryNew
    const candlesRaw = data.candles;
    if (Array.isArray(candlesRaw) && candlesRaw.length > 0) {
      return candlesRaw
        .map((c: unknown) => {
          if (Array.isArray(c) && c.length >= 5) {
            return {
              asset,
              open: Number(c[1]),
              close: Number(c[2]),
              high: Number(c[3]),
              low: Number(c[4]),
              volume: 0,
              timestamp: Number(c[0]),
            };
          }
          return null;
        })
        .filter((c): c is CandleData => c !== null && c.timestamp > 0 && c.close > 0)
        .sort((a, b) => a.timestamp - b.timestamp);
    }

    return [];
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

    // Use mutex to serialize trades on this client
    let releaseMutex: () => void;
    const mutexPromise = new Promise<void>((resolve) => {
      releaseMutex = resolve;
    });
    const prevMutex = this.tradeMutex;
    this.tradeMutex = this.tradeMutex.catch(() => {}).then(() => mutexPromise);

    await prevMutex.catch(() => {});

    try {
      this.orderData = null;
      this.successOpenOrderFlag = false;

      // Add human-like jitter before placing trade
      const jitter = getTradeJitter();
      await new Promise((r) => setTimeout(r, jitter));

      const action = request.direction === "CALL" ? "call" : "put";
      this.openOrder(
        request.asset,
        request.amount,
        action,
        this.isDemo ? 1 : 0,
        request.duration
      );

      const startTime = Date.now();
      // Increase timeout to 45s for slower network conditions
      while (Date.now() - startTime < 45000) {
        // Check for both binary order data AND the success flag
        if (this.orderData !== null) break;
        await new Promise((r) => setTimeout(r, 200));
      }

      if (!this.orderData) {
        console.error(
          `[PO] Trade timeout for ${request.asset}. Order data never received.`
        );
        throw new Error("Trade execution timeout");
      }

      const order = this.orderData as Record<string, unknown>;
      console.log(
        `[PO] Trade executed! Result data:`,
        JSON.stringify(order).substring(0, 200)
      );

      const profit = Number(order.profit ?? -request.amount);

      return {
        win: profit > 0,
        profit,
        openPrice: Number(order.open_price || order.openPrice || 0),
        closePrice: Number(order.close_price || order.closePrice || 0),
        tradeId: String(order.id || order.deal_id || ""),
      };
    } finally {
      releaseMutex!();
    }
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
    // PocketOption uses the Socket.IO 42 message type followed by JSON
    const message = `42${JSON.stringify(data)}`;
    try {
      this.ws.send(message);
      console.log(`[PO] >> ${message.substring(0, 150)}`);
    } catch (err) {
      console.error("[PO] Send error:", err);
    }
  }

  private startHeartbeats(): void {
    this.cleanup();
    // Engine.IO PING every 20 seconds
    this.socketIoHeartbeat = setInterval(() => {
      if (this.ws && this.connected) {
        // Send Engine.IO PING (char "2")
        this.ws.send("2");
        // Also send Socket.IO keep-alive if needed (some PO versions use 42["ps"])
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
