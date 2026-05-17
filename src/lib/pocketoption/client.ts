import WebSocket from "ws";
import https from "https";
import { EventEmitter } from "events";
import {
  WS_HEADERS as CONN_WS_HEADERS,
  HTTP_HEADERS as CONN_HTTP_HEADERS,
  preFetchCookies,
  getReconnectDelay,
  getTradeJitter,
  getBestHost,
  discoverReachableHosts,
  invalidateHostCache,
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

export enum ConnectionState {
  DISCONNECTED = "DISCONNECTED",
  CONNECTING = "CONNECTING",
  POLLING = "POLLING",
  UPGRADING = "UPGRADING",
  WS_OPEN = "WS_OPEN",
  AUTHENTICATING = "AUTHENTICATING",
  READY = "READY",
}

// ============ Mutex with Timeout (Anti-Deadlock) ============
class AsyncMutex {
  private promise: Promise<void> = Promise.resolve();

  async acquire(timeoutMs: number = 45000): Promise<() => void> {
    let release: () => void = () => {};
    const nextPromise = new Promise<void>((resolve) => {
      release = resolve;
    });
    const currentPromise = this.promise;
    this.promise = this.promise.then(() => nextPromise).catch(() => nextPromise);

    await currentPromise;

    const timeoutId = setTimeout(() => {
      console.warn(`[Mutex] Auto-released after ${timeoutMs}ms to prevent deadlock!`);
      release();
    }, timeoutMs);

    return () => {
      clearTimeout(timeoutId);
      release();
    };
  }
}

// ============ Constants ============
const LEGACY_HOSTS = {
  demo: "demo-api-eu.po.market",
  real: "api-eu.po.market",
};

// Circuit breaker: after this many consecutive failures, enter long cooldown
const CIRCUIT_BREAKER_THRESHOLD = 5;
// Max consecutive failures before giving up entirely (waiting for Bridge)
const MAX_HARD_FAILURES = 12;
// Long cooldown delay when circuit is open (ms)
const CIRCUIT_OPEN_DELAY = 5 * 60 * 1000; // 5 minutes

// ============ Monitoring (Institutional Grade) ============

export interface ConnectionMonitorStats {
  reconnectCount: number;
  consecutiveFailures: number;
  uptimeMs: number;
  lastConnectedAt: number | null;
  lastDisconnectedAt: number | null;
  avgReconnectMs: number;
  circuitOpen: boolean;
  zombieDetections: number;
}

// ============ Client ============

export class PocketOptionClient {
  private ssid: string;
  private sessionToken: string = "";
  private ws: WebSocket | null = null;
  public state: ConnectionState = ConnectionState.DISCONNECTED;
  private isDemo = true;

  // Connection Phase tracking
  private upgradeResolve: ((value: void) => void) | null = null;
  private upgradeReject: ((error: Error) => void) | null = null;
  private connectionTimeout: ReturnType<typeof setTimeout> | null = null;

  // Event Driven Architecture
  private publicEvents = new EventEmitter();
  private internalEvents = new EventEmitter();

  // Callbacks arrays kept for legacy public API compatibility
  private candleListeners = new Map<string, ((candle: CandleData) => void)[]>();
  private onAuthCallbacks: (() => void)[] = [];
  private onBalanceCallbacks: ((balance: { balance: number; isDemo: number }) => void)[] = [];
  private onErrorCallbacks: ((error: Error) => void)[] = [];
  private onSsidExpiredCallbacks: (() => void)[] = [];

  // Active subscriptions tracking
  private activeSubscriptions = new Map<string, { asset: string; size: number }>();
  private currentSymbol: { asset: string; period: number } | null = null;

  // Tick Batching / Throttling to prevent CPU flooding
  private pendingTicks = new Map<string, CandleData>();
  private tickFlushInterval: ReturnType<typeof setInterval> | null = null;
  private tickCount = 0;

  // Binary attachment FIFO Queue (fixes async data race)
  private expectedBinaryEvents: string[] = [];

  // Cached response data
  private closedDealsData: unknown[] = [];
  private lastBalance: { balance: number; isDemo: number } | null = null;
  private assetData: Record<string, { payout: number }> = {};

  // Mutex for trading
  private tradeMutex = new AsyncMutex();

  // Heartbeat & Reconnection
  private socketIoHeartbeat: ReturnType<typeof setInterval> | null = null;
  private zombieCheckInterval: ReturnType<typeof setInterval> | null = null;
  private lastPongAt = Date.now();
  private pingInterval = 10000;
  private reconnectAttempts = 0;
  private maxReconnectDelay = 300000; // 5 minutes max backoff
  private intentionallyClosed = false;
  private ssidExpired = false;

  // Circuit Breaker: prevents infinite reconnect loops
  private consecutiveFailures = 0;
  private circuitOpen = false;
  private isReconnecting = false;  // Prevents simultaneous reconnect attempts
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  // Monitoring stats
  private reconnectCount = 0;
  private lastConnectedAt: number | null = null;
  private lastDisconnectedAt: number | null = null;
  private reconnectTimestamps: number[] = [];
  private zombieDetections = 0;

  // Trade Lock
  private prefetchedCookies: string[] = [];

  // Track pending promises to reject them on disconnect (prevent memory leaks)
  private pendingRequests = new Set<(err: Error) => void>();

  constructor(ssid: string, isDemo?: boolean, cookies?: string[]) {
    this.ssid = ssid;
    if (isDemo !== undefined) this.isDemo = isDemo;
    if (cookies) this.prefetchedCookies = [...cookies];

    // Extract pure session token from SSID
    try {
      if (this.ssid.startsWith('42["auth"')) {
        const jsonPart = this.ssid.substring(2);
        const parsed = JSON.parse(jsonPart);
        if (parsed && parsed.length > 1 && typeof parsed[1] === "object" && parsed[1].session) {
          this.sessionToken = parsed[1].session;
        } else if (parsed && parsed.length > 1 && typeof parsed[1] === "string") {
          this.sessionToken = parsed[1];
        }
      } else {
        this.sessionToken = this.ssid;
      }
    } catch (err) {
      this.sessionToken = this.ssid;
    }

    // Add session token as PHPSESSID cookie if not already present
    if (this.sessionToken && !this.prefetchedCookies.some((c) => c.includes("PHPSESSID"))) {
      const cleanSessionToken = this.sessionToken.replace(/[\r\n]/g, "").trim();
      this.prefetchedCookies.push(`PHPSESSID=${cleanSessionToken}`);
    }

    // Increase max listeners for multi-agent support
    this.internalEvents.setMaxListeners(100);
    this.publicEvents.setMaxListeners(100);

    this.startTickThrottler();
  }

  // ============ Internal Event Helpers ============

  /** Promisified event listener, eliminating busy-waiting while loops */
  private async waitForEvent<T>(eventName: string, timeoutMs: number, predicate?: (data: T) => boolean): Promise<T> {
    return new Promise((resolve, reject) => {
      let isSettled = false;

      const rejectHandler = (err: Error) => {
        if (isSettled) return;
        isSettled = true;
        clearTimeout(timeout);
        this.internalEvents.off(eventName, listener);
        this.pendingRequests.delete(rejectHandler);
        reject(err);
      };
      this.pendingRequests.add(rejectHandler);

      const timeout = setTimeout(() => {
        rejectHandler(new Error(`Timeout waiting for internal event: ${eventName} (${timeoutMs}ms)`));
      }, timeoutMs);

      const listener = (data: T) => {
        if (!predicate || predicate(data)) {
          if (isSettled) return;
          isSettled = true;
          clearTimeout(timeout);
          this.internalEvents.off(eventName, listener);
          this.pendingRequests.delete(rejectHandler);
          resolve(data);
        }
      };
      this.internalEvents.on(eventName, listener);
    });
  }

  // ============ Connection Management ============

  private startHeartbeats(): void {
    if (this.socketIoHeartbeat) clearInterval(this.socketIoHeartbeat);
    this.lastPongAt = Date.now();
    this.lastConnectedAt = Date.now();
    let tickCounter = 0;

    this.socketIoHeartbeat = setInterval(() => {
      if (this.state !== ConnectionState.READY || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;

      // Zombie socket detection: socket reports OPEN but pong is dead
      const elapsed = Date.now() - this.lastPongAt;
      if (elapsed > 35000) {
        console.warn(`[PO] Zombie detected! Pong timeout (${Math.round(elapsed / 1000)}s), forcing clean reconnect...`);
        this.zombieDetections++;
        this.handleDisconnect();
        return;
      }

      try {
        this.ws.send("2"); // Engine.IO Ping
        if (tickCounter % 2 === 0) {
          this.ws.send('42["ps"]'); // Socket.IO keep-alive every 20s
        }
        // ── Étape 3.1 : Balance polling périodique (toutes les 60s) ──
        if (tickCounter % 6 === 0) {
          this.ws.send('42["getBalance"]');
        }
        tickCounter++;
      } catch (err) {
        console.error("[PO] Failed to send heartbeat:", err);
        this.handleDisconnect();
      }
    }, this.pingInterval);
  }

  private handlePong(): void {
    this.lastPongAt = Date.now();
  }

  get isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN && this.state === ConnectionState.READY;
  }

  /**
   * BUG FIX #1: Validate and sanitize cookies
   * Removes malformed cookies that could cause HTTP 400
   * - Strips whitespace, checks for required format, deduplicates
   */
  private _validateAndCleanCookies(cookies: string[]): string[] {
    if (!Array.isArray(cookies)) return [];

    const validated: string[] = [];
    const seen = new Set<string>();

    for (const cookie of cookies) {
      if (!cookie || typeof cookie !== "string") continue;

      // Trim whitespace
      const trimmed = cookie.trim();
      if (!trimmed) continue;

      // Must have = sign (key=value format)
      if (!trimmed.includes("=")) {
        console.warn(`[PO] Skipping malformed cookie (no =): ${trimmed.substring(0, 30)}`);
        continue;
      }

      // Extract key for deduplication
      const key = trimmed.split("=")[0].toLowerCase();
      if (seen.has(key)) {
        console.warn(`[PO] Skipping duplicate cookie key: ${key}`);
        continue;
      }

      // Check for invalid characters (newlines, control chars)
      if (/[\r\n\x00-\x08\x0b\x0c\x0e-\x1f]/.test(trimmed)) {
        console.warn(`[PO] Skipping cookie with control chars: ${key}`);
        continue;
      }

      validated.push(trimmed);
      seen.add(key);
    }

    if (validated.length < cookies.length) {
      console.log(`[PO] Cleaned cookies: ${cookies.length} → ${validated.length}`);
    }

    return validated;
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

  getAccountData(): { balance: number | null; isDemo: number; closedDeals: unknown[] } {
    return {
      balance: this.lastBalance?.balance ?? null,
      isDemo: this.lastBalance?.isDemo ?? (this.isDemo ? 1 : 0),
      closedDeals: this.closedDealsData,
    };
  }

  static toPOSymbol(asset: string): string {
    if (asset.includes("(OTC)")) return asset.replace("/", "").replace(" (OTC)", "_otc");
    if (asset.includes("/")) return asset.replace("/", "");
    return asset;
  }

  // ============ Connection ============

  async connect(isDemo?: boolean): Promise<void> {
    if (this.state === ConnectionState.READY) return;
    if (this.state !== ConnectionState.DISCONNECTED) {
      console.warn(`[PO] Cannot connect, state is currently: ${this.state}`);
      return;
    }

    this.state = ConnectionState.CONNECTING;
    this.isDemo = isDemo ?? this.parseIsDemoFromSsid();
    this.intentionallyClosed = false;
    this.ssidExpired = false;

    let reachableHosts = await discoverReachableHosts(this.isDemo);
    if (reachableHosts.length === 0) {
      const fallback = this.isDemo ? LEGACY_HOSTS.demo : LEGACY_HOSTS.real;
      reachableHosts = [fallback];
    }

    let gotNotAuthorizedOnMatchingHost = false;

    for (const host of reachableHosts) {
      console.log(`[PO] Trying host: ${host}`);
      this.ssidExpired = false;

      // Pre-fetch Cloudflare + session cookies from the target host
      const { cookies: hostCookies } = await preFetchCookies(host);
      if (hostCookies.length > 0) {
        this.prefetchedCookies = [...new Set([...this.prefetchedCookies, ...hostCookies])];
      }

      // Strategy 1: Direct WebSocket
      try {
        await this.connectDirect(host);
        return;
      } catch (directErr: any) {
        console.warn(`[PO] Direct WebSocket failed on ${host}: ${directErr.message}`);
        if (this.checkAuthFailure(host)) {
          gotNotAuthorizedOnMatchingHost = true;
          break;
        }
      }

      // Strategy 2: Full Engine.IO v4 HTTP Polling upgrade
      try {
        await this.connectWithUpgrade(host);
        return;
      } catch (upgradeErr: any) {
        console.warn(`[PO] Upgrade failed on ${host}: ${upgradeErr.message}`);
        if (this.checkAuthFailure(host)) {
          gotNotAuthorizedOnMatchingHost = true;
          break;
        }
      }
    }

    this.state = ConnectionState.DISCONNECTED;
    if (gotNotAuthorizedOnMatchingHost) {
      throw new Error("SSID expiré ou invalide (NotAuthorized)");
    }
    throw new Error(`Failed to connect: all hosts failed. Check network or SSID.`);
  }

  private checkAuthFailure(host: string): boolean {
    return this.ssidExpired;
  }

  private connectDirect(host: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const wsUrl = `wss://${host}/socket.io/?EIO=4&transport=websocket`;
      let settled = false;
      const settle = (err?: Error) => {
        if (settled) return;
        settled = true;
        if (this.connectionTimeout) { clearTimeout(this.connectionTimeout); this.connectionTimeout = null; }
        if (err) reject(err); else resolve();
      };

      try {
        // BUG FIX #1: Validate and sanitize cookies before sending
        const validatedCookies = this._validateAndCleanCookies(this.prefetchedCookies);

        const wsHeaders: Record<string, string> = { ...CONN_WS_HEADERS };
        if (validatedCookies.length > 0) wsHeaders["Cookie"] = validatedCookies.join("; ");

        const ws = new WebSocket(wsUrl, {
          headers: wsHeaders,
          handshakeTimeout: 30000,
          perMessageDeflate: false,
          followRedirects: true,
        });
        this.ws = ws;
        this.upgradeResolve = resolve;
        this.upgradeReject = reject;

        this.connectionTimeout = setTimeout(() => {
          settle(new Error("Connection timeout (30s)"));
          this.safeCloseWs(ws);
        }, 30000);

        ws.on("open", () => { this.state = ConnectionState.WS_OPEN; });
        ws.on("message", (raw: WebSocket.Data) => {
          try {
            this.handleRawMessage(raw);
          } catch (err) {
            console.error("[PO] Message handler error:", err);
          }
        });
        ws.on("close", () => {
          try {
            if (!settled) settle(new Error("Disconnected before READY"));
            if (this.ws === ws) this.handleDisconnect();
          } catch (err) {
            console.error("[PO] Close handler error:", err);
          }
        });
        ws.on("error", (err: Error) => {
          try {
            console.warn(`[PO] WebSocket error:`, err.message);
            settle(err);
            if (this.ws === ws) { this.ws = null; }
            this.safeCloseWs(ws);
          } catch (err2) {
            console.error("[PO] Error handler crashed:", err2);
          }
        });
      } catch (err: any) {
        settle(err);
      }
    });
  }

  private async connectWithUpgrade(host: string): Promise<void> {
    this.state = ConnectionState.POLLING;
    const { sid, cookies } = await this.httpPollingOpen(host);
    if (!sid) throw new Error("Failed to get sid");

    this.state = ConnectionState.UPGRADING;
    return new Promise((resolve, reject) => {
      // BUG FIX #2: Properly encode sid for URL (base64 has +, /, =)
      const encodedSid = encodeURIComponent(sid);
      const wsUrl = `wss://${host}/socket.io/?EIO=4&transport=websocket&sid=${encodedSid}`;
      let settled = false;
      const settle = (err?: Error) => {
        if (settled) return;
        settled = true;
        if (this.connectionTimeout) { clearTimeout(this.connectionTimeout); this.connectionTimeout = null; }
        if (err) reject(err); else resolve();
      };

      try {
        // BUG FIX #1: Validate and sanitize cookies
        const allCookies = this._validateAndCleanCookies([...this.prefetchedCookies, ...cookies]);

        const wsOptions: WebSocket.ClientOptions = {
          headers: {
            ...CONN_WS_HEADERS,
            ...(allCookies.length > 0 ? { Cookie: allCookies.join("; ") } : {}),
          },
          handshakeTimeout: 30000,
          perMessageDeflate: false,
        };

        const ws = new WebSocket(wsUrl, wsOptions);
        this.ws = ws;
        this.upgradeResolve = resolve;
        this.upgradeReject = reject;

        // BUG FIX #3: Track Engine.IO probe phase
        let probePhaseComplete = false;

        this.connectionTimeout = setTimeout(() => {
          settle(new Error("Upgrade timeout (30s)"));
          this.safeCloseWs(ws);
        }, 30000);

        ws.on("open", () => { this.state = ConnectionState.WS_OPEN; });
        ws.on("message", (raw: WebSocket.Data) => {
          try {
            const text = Buffer.isBuffer(raw) ? raw.toString("utf8") : String(raw);

            // Handle Engine.IO probe phase
            if (text === "3probe" && !probePhaseComplete) {
              console.log("[PO] Received Engine.IO probe, responding with 5");
              ws.send("5");
              probePhaseComplete = true;
              return;
            }

            this.handleRawMessage(raw);
          } catch (err) {
            console.error("[PO] Message handler error:", err);
          }
        });
        ws.on("close", () => {
          try {
            if (!settled) settle(new Error("Disconnected before READY"));
            if (this.ws === ws) this.handleDisconnect();
          } catch (err) {
            console.error("[PO] Close handler error:", err);
          }
        });
        ws.on("error", (err: Error) => {
          try {
            console.warn(`[PO] WebSocket upgrade error:`, err.message);
            settle(err);
            if (this.ws === ws) { this.ws = null; }
            this.safeCloseWs(ws);
          } catch (err2) {
            console.error("[PO] Error handler crashed:", err2);
          }
        });
      } catch (err: any) {
        settle(err);
      }
    });
  }

  // ============ HTTP Polling Methods (Kept for strict Engine.IO compliance) ============

  private httpPollingOpen(host: string): Promise<{ sid: string; cookies: string[] }> {
    return new Promise((resolve, reject) => {
      const req = https.get({
        hostname: host,
        path: `/socket.io/?EIO=4&transport=polling&t=${Date.now()}`,
        method: "GET",
        headers: {
          ...CONN_HTTP_HEADERS,
          Host: host,
          ...(this.prefetchedCookies.length > 0 ? { Cookie: this.prefetchedCookies.join("; ") } : {}),
        },
      }, (res) => {
        const cookies = (res.headers["set-cookie"] || []).map((c: string) => c.split(";")[0]);
        let body = "";
        res.on("data", (chunk: Buffer) => { body += chunk.toString(); });
        res.on("end", () => {
          if (res.statusCode !== 200) {
            reject(new Error(`HTTP polling rejected: ${res.statusCode} - ${body.substring(0, 100)}`));
            return;
          }
          try {
            if (body.startsWith("0")) {
              const sid = JSON.parse(body.substring(1)).sid || "";
              if (!sid) throw new Error("Empty sid in parsed JSON");
              resolve({ sid, cookies });
            } else {
              const match = body.match(/"sid"\s*:\s*"([^"]+)"/);
              const sid = match ? match[1] : "";
              if (!sid) throw new Error("Regex failed to find sid");
              resolve({ sid, cookies });
            }
          } catch (err: any) {
            console.warn(`[PO] httpPollingOpen failed to parse sid. Body: ${body.substring(0, 150)}`);
            reject(new Error(`Failed to parse socket.io sid: ${err.message}`));
          }
        });
      });
      req.on("error", (err: Error) => reject(new Error(`HTTP polling failed: ${err.message}`)));
      req.setTimeout(15000, () => { req.destroy(); reject(new Error("HTTP polling timeout")); });
    });
  }

  private httpPollingPost(host: string, sid: string, body: string, cookies: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      const bodyBuf = Buffer.from(body, "utf8");
      const allCookies = [...this.prefetchedCookies, ...cookies];
      const req = https.request({
        hostname: host,
        path: `/socket.io/?EIO=4&transport=polling&sid=${encodeURIComponent(sid)}`,
        method: "POST",
        headers: {
          ...CONN_HTTP_HEADERS,
          Host: host,
          "Content-Type": "text/plain; charset=UTF-8",
          "Content-Length": bodyBuf.length,
          ...(allCookies.length > 0 ? { Cookie: allCookies.join("; ") } : {}),
        },
      }, (res) => {
        res.on("data", () => {});
        res.on("end", () => resolve());
      });
      req.on("error", (err: Error) => reject(new Error(`POST failed: ${err.message}`)));
      req.setTimeout(15000, () => { req.destroy(); reject(new Error("POST timeout")); });
      req.write(bodyBuf);
      req.end();
    });
  }

  private httpPollingRead(host: string, sid: string, cookies: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      const allCookies = [...this.prefetchedCookies, ...cookies];
      const req = https.request({
        hostname: host,
        path: `/socket.io/?EIO=4&transport=polling&sid=${encodeURIComponent(sid)}`,
        method: "GET",
        headers: {
          ...CONN_HTTP_HEADERS,
          Host: host,
          ...(allCookies.length > 0 ? { Cookie: allCookies.join("; ") } : {}),
        },
      }, (res) => {
        let data = "";
        res.on("data", (chunk: Buffer) => { data += chunk.toString(); });
        res.on("end", () => resolve(data));
      });
      req.on("error", (err: Error) => reject(new Error(`GET failed: ${err.message}`)));
      req.setTimeout(15000, () => { req.destroy(); reject(new Error("GET timeout")); });
      req.end();
    });
  }

  // ============ Message Routing ============

  private handleRawMessage(raw: WebSocket.Data): void {
    try {
      let text: string;
      if (Buffer.isBuffer(raw)) text = raw.toString("utf8");
      else if (typeof raw === "string") text = raw;
      else text = raw.toString();

      const firstChar = text.charAt(0);
      if (["0", "1", "2", "3", "4", "5", "6"].includes(firstChar)) {
        this.handleTextMessage(text);
      } else {
        const buf = Buffer.isBuffer(raw) ? raw : Buffer.from(typeof raw === "string" ? raw : new Uint8Array(raw as ArrayBuffer));
        this.handleBinaryMessage(buf);
      }
    } catch (err) {
      console.error("[PO] Message handling error:", err);
    }
  }

  // ============ Text Message Handler ============

  private handleTextMessage(message: string): void {
    if (message.startsWith("0")) {
      this.ws?.send("40"); // Socket.IO CONNECT
      // Engine.IO requires waiting for '0' before starting ping/pong
      this.startHeartbeats();
      return;
    }
    if (message.startsWith("1")) {
      this.ws?.close();
      return;
    }
    if (message === "2") {
      this.ws?.send("3"); // PONG
      return;
    }
    if (message === "3probe") {
      this.ws?.send("5");
      if (this.state === ConnectionState.UPGRADING) this.ws?.send("40");
      return;
    }
    if (message === "3") {
      this.handlePong();
      return;
    }
    if (message === "6") return;

    if (message.startsWith("40")) {
      this.state = ConnectionState.AUTHENTICATING;

      // Build auth message with pure session token
      const authMessage = '42' + JSON.stringify([
        "auth",
        {
          session: this.sessionToken,
          isDemo: this.isDemo ? 1 : 0,
          uid: 0,
          platform: 2,
          isFastHistory: true,
          isOptimized: true
        }
      ]);

      this.ws?.send(authMessage);
      return;
    }

    if (message.startsWith("42")) {
      try {
        const data = JSON.parse(message.substring(2));
        if (Array.isArray(data) && data.length >= 1) {
          const eventName = data[0];
          if (eventName === "NotAuthorized") {
            this.handleNotAuthorized();
            return;
          }
          this.handleSocketIOEvent(eventName, data[1]);
        }
      } catch {}
      return;
    }

    if (message.startsWith("451-")) {
      const jsonPart = message.substring(message.indexOf("-") + 1);
      try {
        const data = JSON.parse(jsonPart);
        if (Array.isArray(data) && data.length >= 1) {
          const eventName = data[0];
          const eventData = data[1];

          if (eventData && typeof eventData === "object" && (eventData as any)._placeholder) {
            // Push to queue, expect next binary to belong to this
            this.expectedBinaryEvents.push(eventName);
          } else {
            this.handleSocketIOEvent(eventName, eventData);
          }
        }
      } catch (err) {}
      return;
    }
  }

  private async handleNotAuthorized() {
    console.warn(`[PO] Received NotAuthorized. SSID expired or invalid.`);
    this.ssidExpired = true;
    this.intentionallyClosed = true;
    this.state = ConnectionState.DISCONNECTED;
    
    // Secure callback execution
    for (const cb of this.onSsidExpiredCallbacks) {
      try {
        if (typeof cb === "function") cb();
      } catch (err) {
        console.error("[PO] Error executing onSsidExpired callback:", err);
      }
    }

    // Stop auto-refresh and connection immediately. Let the system wait for a new valid SSID.
    // If the system still wants to refresh automatically, it must be triggered manually from the bot-runner or trading service.
    // We do NOT attempt to reconnect from here to prevent infinite loop spamming.
    console.warn(`[PO] Halting all reconnection attempts due to expired SSID.`);

    if (this.connectionTimeout) clearTimeout(this.connectionTimeout);
    if (this.upgradeReject) this.upgradeReject(new Error("NotAuthorized: SSID invalide"));
    this.ws?.close();
  }

  // ============ Socket.IO Event Handler ============

  getMonitorStats(): ConnectionMonitorStats {
    const avgReconnect = this.reconnectTimestamps.length > 1
      ? (this.reconnectTimestamps[this.reconnectTimestamps.length - 1] - this.reconnectTimestamps[0]) / (this.reconnectTimestamps.length - 1)
      : 0;
    return {
      reconnectCount: this.reconnectCount,
      consecutiveFailures: this.consecutiveFailures,
      uptimeMs: this.lastConnectedAt ? Date.now() - this.lastConnectedAt : 0,
      lastConnectedAt: this.lastConnectedAt,
      lastDisconnectedAt: this.lastDisconnectedAt,
      avgReconnectMs: Math.round(avgReconnect),
      circuitOpen: this.circuitOpen,
      zombieDetections: this.zombieDetections,
    };
  }

  private handleSocketIOEvent(eventName: string, eventData: any): void {
    switch (eventName) {
      case "successauth":
        this.state = ConnectionState.READY;
        // Reset circuit breaker on successful auth
        this.reconnectAttempts = 0;
        this.consecutiveFailures = 0;
        this.circuitOpen = false;
        this.isReconnecting = false;
        this.startHeartbeats();
        if (this.connectionTimeout) clearTimeout(this.connectionTimeout);
        if (this.upgradeResolve) this.upgradeResolve();

        for (const [, sub] of this.activeSubscriptions) {
          this.changeSymbol(sub.asset, sub.size);
        }

        // Auto-fetch account data after successful auth
        try {
          this.getBalances();
          this.internalEvents.emit("reconnected", { isDemo: this.isDemo });
        } catch (err) {
          console.error("[PO] Error fetching account data after reconnect:", err);
        }

        for (const cb of this.onAuthCallbacks) {
          try {
            if (typeof cb === "function") cb();
          } catch (err) {
            console.error("[PO] Error executing onAuth callback:", err);
          }
        }
        break;

      case "successopenOrder":
        this.internalEvents.emit("successopenOrder", eventData || { _textOnly: true });
        break;

      case "updateClosedDeals":
        if (Array.isArray(eventData)) {
          this.closedDealsData = eventData;
          this.internalEvents.emit("updateClosedDeals", eventData);
        }
        break;

      case "loadHistoryPeriod":
      case "loadHistoryPeriodFast":
        this.internalEvents.emit("history", eventData);
        break;

      case "updateStream":
        break;

      case "updateHistoryNew":
      case "updateHistoryNewFast":
        this.processHistoryNew(eventData);
        this.internalEvents.emit("historyNew", eventData);
        break;
    }
  }

  // ============ Binary Message Handler ============

  private handleBinaryMessage(buffer: Buffer): void {
    let message: any;
    try {
      const raw = buffer.toString("utf8");
      message = JSON.parse(raw);
    } catch {
      if (buffer.length === 8) {
        const bal = buffer.readDoubleLE(0);
        if (bal > 0 && bal < 10000000) this.updateBalance(bal);
      }
      return;
    }

    if (this.expectedBinaryEvents.length > 0) {
      const eventName = this.expectedBinaryEvents.shift()!;
      switch (eventName) {
        case "loadHistoryPeriod":
        case "loadHistoryPeriodFast":
          this.internalEvents.emit("history", message);
          break;
        case "updateHistoryNew":
        case "updateHistoryNewFast":
          this.processHistoryNew(message);
          this.internalEvents.emit("historyNew", message);
          break;
        case "updateClosedDeals":
          if (Array.isArray(message)) {
            this.closedDealsData = message;
            this.internalEvents.emit("updateClosedDeals", message);
          }
          break;
        case "updateStream":
          if (Array.isArray(message)) this.processStreamTick(message);
          break;
        case "updateAssets":
          if (Array.isArray(message)) {
            for (const asset of message) {
              if (asset && asset.symbol && asset.payout) this.assetData[asset.symbol] = { payout: Number(asset.payout) / 100 };
            }
          }
          break;
        case "successauth":
        case "successupdateBalance":
        case "successupdatePending":
          if (message && message.balance !== undefined) this.updateBalance(Number(message.balance), message.isDemo);
          if (eventName === "successauth") this.handleSocketIOEvent("successauth", message);
          break;
        case "successopenOrder":
          this.internalEvents.emit("successopenOrder", message);
          break;
      }
      return;
    }

    // Unmapped binary JSON fallback
    if (message && typeof message === "object") {
      if (message.balance !== undefined) this.updateBalance(Number(message.balance), message.isDemo);
      if (message.requestId !== undefined) this.internalEvents.emit("successopenOrder", message);
      if (Array.isArray(message) && message.length > 0 && Array.isArray(message[0])) {
        // Probable tick stream
        this.processStreamTick(message);
      }
    }
  }

  private updateBalance(bal: number, isDemo?: any) {
    this.lastBalance = {
      balance: bal,
      isDemo: Number(isDemo !== undefined ? isDemo : (this.isDemo ? 1 : 0)),
    };
    for (const cb of this.onBalanceCallbacks) {
      try {
        if (typeof cb === "function") cb(this.lastBalance!);
      } catch (err) {
        console.error("[PO] Error executing onBalance callback:", err);
      }
    }
  }

  // ============ History & Tick Processing ============

  private startTickThrottler() {
    this.tickFlushInterval = setInterval(() => {
      for (const [asset, candle] of this.pendingTicks.entries()) {
        const listeners = this.candleListeners.get(asset) || [];
        for (const listener of listeners) {
          try { listener(candle); } catch {}
        }
      }
      this.pendingTicks.clear();
    }, 100); // 10 updates per second per asset max
  }

  private processStreamTick(message: any[]): void {
    const asset = this.currentSymbol?.asset;
    if (!asset || this.state !== ConnectionState.READY) return;

    for (const entry of message) {
      if (!Array.isArray(entry) || entry.length < 2) continue;
      const timestamp = entry.length >= 3 ? Number(entry[0]) : Number(entry[0]);
      const price = entry.length >= 3 ? Number(entry[2]) : Number(entry[1]);

      if (price <= 0 || timestamp <= 0) continue;

      const existing = this.pendingTicks.get(asset);
      if (existing) {
        existing.high = Math.max(existing.high, price);
        existing.low = Math.min(existing.low, price);
        existing.close = price;
        existing.timestamp = timestamp;
      } else {
        this.pendingTicks.set(asset, {
          asset, open: price, high: price, low: price, close: price, volume: 0, timestamp
        });
      }
    }
  }

  private processHistoryNew(data: any): void {
    const asset = this.currentSymbol?.asset;
    if (!asset) return;
    const candles = this.parseCandleData(asset, data);
    for (const candle of candles) {
      const listeners = this.candleListeners.get(asset) || [];
      for (const listener of listeners) {
        try { listener(candle); } catch {}
      }
    }
  }

  private parseCandleData(asset: string, data: any): CandleData[] {
    if (!data) return [];
    let parsed: CandleData[] = [];

    if (Array.isArray(data.data) && data.data.length > 0) {
      if (typeof data.data[0] === "object" && "time" in data.data[0]) {
        parsed = data.data.map((c: any) => ({
          asset, open: Number(c.open || 0), high: Number(c.high || 0), low: Number(c.low || 0),
          close: Number(c.close || 0), volume: 0, timestamp: Number(c.time || 0),
        }));
      } else if (Array.isArray(data.data[0])) {
        parsed = data.data.map((c: any[]) => ({
          asset, open: Number(c[1] || 0), close: Number(c[2] || 0), high: Number(c[3] || 0),
          low: Number(c[4] || 0), volume: Number(c[5] || 0), timestamp: Number(c[0] || 0),
        }));
      }
    } else if (Array.isArray(data.candles) && data.candles.length > 0) {
      parsed = data.candles.map((c: any[]) => ({
        asset, open: Number(c[1]), close: Number(c[2]), high: Number(c[3]),
        low: Number(c[4]), volume: 0, timestamp: Number(c[0]),
      }));
    } else if (Array.isArray(data) && data.length > 0 && Array.isArray(data[0])) {
      // Sometimes it just returns an array of arrays directly
      parsed = data.map((c: any[]) => ({
        asset, open: Number(c[1] || 0), close: Number(c[2] || 0), high: Number(c[3] || 0),
        low: Number(c[4] || 0), volume: Number(c[5] || 0), timestamp: Number(c[0] || 0),
      }));
    } else {
      console.warn(`[PO] parseCandleData received unknown format for ${asset}:`, JSON.stringify(data).substring(0, 200));
    }

    const filtered = parsed.filter((c) => c && c.timestamp > 0 && c.close > 0).sort((a, b) => a.timestamp - b.timestamp);
    if (filtered.length === 0) {
      console.warn(`[PO] parseCandleData yielded 0 valid candles for ${asset}. Raw parsed length: ${parsed.length}`);
    }
    return filtered;
  }

  // ============ Disconnect & Cleanup ============

  /** Safely close a WebSocket without triggering recursive handlers */
  private safeCloseWs(ws: WebSocket): void {
    // Idempotent: remove all listeners FIRST to prevent recursive close events
    try { ws.removeAllListeners(); } catch {}
    try {
      const state = ws.readyState;
      if (state === WebSocket.OPEN || state === WebSocket.CONNECTING) {
        // Deferred close: gives any in-flight frames time to flush
        setTimeout(() => {
          try {
            if (ws.readyState !== WebSocket.CLOSED && ws.readyState !== WebSocket.CLOSING) {
              ws.close();
            }
          } catch (innerErr) {
            // Silently swallowed — this path is hit when WS was never fully open
            console.warn(`[PO-SafeGuard] Ignored deferred close error:`, (innerErr as Error).message);
          }
        }, 200);
      }
    } catch (err) {
      console.warn(`[PO-SafeGuard] safeCloseWs outer error (ignored):`, (err as Error).message);
    }
  }

  private handleDisconnect(): void {
    // Anti-race: Only one disconnect handler should run at a time
    const prevState = this.state;
    if (this.state === ConnectionState.DISCONNECTED && !this.ws) {
      return; // Already cleaned up
    }
    console.log(`[PO] handleDisconnect called. State was: ${prevState}, intentionallyClosed: ${this.intentionallyClosed}`);
    this.lastDisconnectedAt = Date.now();
    this.state = ConnectionState.DISCONNECTED;

    if (this.upgradeReject) {
      this.upgradeReject(new Error("Disconnected before READY"));
    }
    this.upgradeResolve = null;
    this.upgradeReject = null;

    if (this.connectionTimeout) {
      clearTimeout(this.connectionTimeout);
      this.connectionTimeout = null;
    }
    this.cleanup();

    if (this.ws) {
      this.safeCloseWs(this.ws);
      this.ws = null;
    }

    // Never reconnect if SSID expired or closed intentionally
    if (this.intentionallyClosed || this.ssidExpired) {
      if (this.ssidExpired) {
        console.warn(`[PO] Halting auto-reconnect: SSID expired. Waiting for Bridge sync.`);
      }
      this.isReconnecting = false;
      return;
    }

    // Anti-simultaneous-reconnect guard
    if (this.isReconnecting) {
      console.log(`[PO] Reconnect already scheduled, skipping duplicate.`);
      return;
    }

    // Circuit breaker: increment and check threshold
    this.consecutiveFailures++;
    this.reconnectCount++;
    this.reconnectTimestamps.push(Date.now());
    if (this.reconnectTimestamps.length > 20) this.reconnectTimestamps.shift();

    // Hard limit: if too many failures, enter circuit-open state
    if (this.consecutiveFailures >= MAX_HARD_FAILURES) {
      console.error(`[PO] Circuit HARD OPEN after ${this.consecutiveFailures} consecutive failures. ` +
        `Waiting for Bridge to provide a fresh session.`);
      this.circuitOpen = true;
      this.isReconnecting = false;
      // Signal bot runner (via ssidExpired flag) to pause until Bridge re-syncs
      this.ssidExpired = true;
      for (const cb of this.onSsidExpiredCallbacks) {
        try { if (typeof cb === "function") cb(); } catch {}
      }
      return;
    }

    // Circuit breaker: after threshold, use long cooldown
    const isSoftOpen = this.consecutiveFailures >= CIRCUIT_BREAKER_THRESHOLD;
    if (isSoftOpen && !this.circuitOpen) {
      console.warn(`[PO] Circuit soft-open after ${this.consecutiveFailures} failures — will retry in 5 minutes.`);
      this.circuitOpen = true;
    }

    const delay = this.circuitOpen
      ? CIRCUIT_OPEN_DELAY
      : getReconnectDelay(this.reconnectAttempts, this.maxReconnectDelay);

    this.reconnectAttempts++;
    this.isReconnecting = true;

    // Cancel any existing scheduled reconnect
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }

    console.log(`[PO] Scheduling reconnect in ${Math.round(delay / 1000)}s (attempt ${this.reconnectAttempts}, failures: ${this.consecutiveFailures})...`);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.isReconnecting = false;
      if (this.state === ConnectionState.DISCONNECTED && !this.intentionallyClosed && !this.ssidExpired) {
        // Invalidate host cache so we rediscover on reconnect
        if (this.circuitOpen) {
          invalidateHostCache();
          this.circuitOpen = false;
          console.log(`[PO] Circuit reset — attempting fresh discovery...`);
        }
        this.connect(this.isDemo).catch((err) => {
          console.error(`[PO] Reconnect failed:`, err.message);
        });
      }
    }, delay);
  }

  disconnect(): void {
    this.intentionallyClosed = true;
    this.state = ConnectionState.DISCONNECTED;
    this.isReconnecting = false;
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    this.cleanup();
    if (this.ws) {
      this.safeCloseWs(this.ws);
      this.ws = null;
    }
  }

  private cleanup(): void {
    if (this.socketIoHeartbeat) { clearInterval(this.socketIoHeartbeat); this.socketIoHeartbeat = null; }
    if (this.zombieCheckInterval) { clearInterval(this.zombieCheckInterval); this.zombieCheckInterval = null; }
    if (this.tickFlushInterval) { clearInterval(this.tickFlushInterval); this.tickFlushInterval = null; }
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    if (this.connectionTimeout) { clearTimeout(this.connectionTimeout); this.connectionTimeout = null; }
    this.expectedBinaryEvents = [];

    // Abort all hanging promises safely
    for (const rejectFn of this.pendingRequests) {
      try { rejectFn(new Error("Connection closed or cleaned up")); } catch {}
    }
    this.pendingRequests.clear();

    // Wipe all internal listeners to prevent phantom events
    this.internalEvents.removeAllListeners();
  }

  // ============ Commands ============

  changeSymbol(asset: string, period: number): void {
    const poAsset = PocketOptionClient.toPOSymbol(asset);
    this.currentSymbol = { asset, period };
    this.activeSubscriptions.set(`${asset}:${period}`, { asset, size: period });
    this.sendEvent(["changeSymbol", { asset: poAsset, period }]);
  }

  loadHistoryPeriod(asset: string, period: number, endTime: number, offset: number): void {
    this.sendEvent(["loadHistoryPeriod", { asset: PocketOptionClient.toPOSymbol(asset), index: endTime, time: endTime, offset, period }]);
  }

  openOrder(asset: string, amount: number, action: "call" | "put", isDemo: number, time: number): void {
    this.sendEvent(["openOrder", {
      asset: PocketOptionClient.toPOSymbol(asset), amount: Number(amount), action: action.toLowerCase(),
      isDemo: Number(isDemo), requestId: Date.now(), optionType: 100, time: Number(time),
    }]);
  }

  getBalances(): void {
    this.sendEvent(["getBalance"]);
  }

  private sendEvent(data: unknown): void {
    if (!this.ws || this.state !== ConnectionState.READY) return;
    try {
      // Socket.IO 42 messages MUST be arrays of arguments
      const payload = Array.isArray(data) ? data : [data];
      this.ws.send(`42${JSON.stringify(payload)}`);
    } catch (err) {
      console.error("[PO] Send error:", err);
    }
  }

  // ============ Async Public API ============

  async requestCandleHistory(asset: string, period: number, count: number): Promise<CandleData[]> {
    if (this.state !== ConnectionState.READY) return [];
    const poAsset = PocketOptionClient.toPOSymbol(asset);

    if (this.currentSymbol?.asset !== asset || this.currentSymbol?.period !== period) {
      this.changeSymbol(asset, period);
    } else {
      this.sendEvent(["changeSymbol", { asset: poAsset, period }]);
    }

    try {
      const historyNew = await this.waitForEvent<any>("historyNew", 3000);
      const candles = this.parseCandleData(asset, historyNew);
      if (candles.length >= count) return candles;
    } catch (e) {}

    const endTime = Math.floor(Date.now() / 1000);
    this.loadHistoryPeriod(poAsset, period, endTime, Math.max(count, 300));
    
    try {
      const history = await this.waitForEvent<any>("history", 6000);
      const candles = this.parseCandleData(asset, history);
      if (candles.length > 0) return candles;
    } catch (e) {}

    return [];
  }

  async placeTrade(request: { asset: string; direction: "CALL" | "PUT"; amount: number; duration: number }): Promise<TradeResult> {
    if (this.state !== ConnectionState.READY) throw new Error("Not connected");

    const releaseMutex = await this.tradeMutex.acquire();

    try {
      await new Promise((r) => setTimeout(r, getTradeJitter()));

      const pendingRequestId = Date.now();
      this.openOrder(request.asset, request.amount, request.direction === "CALL" ? "call" : "put", this.isDemo ? 1 : 0, request.duration);

      // Event Driven Phase 1: Confirmation
      const order = await this.waitForEvent<any>("successopenOrder", 15000);
      if (!order) throw new Error("Trade confirmation empty");

      const tradeId = String(order.id ?? order.deal_id ?? pendingRequestId);
      const openPrice = Number(order.open_price ?? order.openPrice ?? 0);

      // Event Driven Phase 2: Result
      const tradeDurationMs = request.duration * 1000;
      await new Promise((r) => setTimeout(r, tradeDurationMs));

      this.getBalances();

      const match = await this.waitForEvent<any[]>("updateClosedDeals", 30000, (deals) => {
        return deals.some(d => String(d.id ?? d.deal_id) === tradeId);
      });

      const deal = match.find(d => String(d.id ?? d.deal_id) === tradeId);
      let rawProfit = Number(deal.profit ?? deal.win_amount ?? 0);
      const closePrice = Number(deal.close_price ?? deal.closePrice ?? 0);

      // Déduction stricte du Net Profit
      let netProfit = 0;
      let isWin = false;

      if (rawProfit < 0) {
        // Format Net Profit direct (ex: -10)
        netProfit = rawProfit;
        isWin = false;
      } else if (rawProfit === 0) {
        // Format Payout direct (Perte = 0 payout)
        netProfit = -request.amount;
        isWin = false;
      } else if (rawProfit === request.amount) {
        // Remboursement (Tie)
        netProfit = 0;
        isWin = false;
      } else if (rawProfit > request.amount) {
        // Format Payout direct (Gain = 18.5)
        netProfit = rawProfit - request.amount;
        isWin = true;
      } else {
        // Format Net Profit direct (Gain = 8.5)
        netProfit = rawProfit;
        isWin = true;
      }

      return { win: isWin, profit: netProfit, openPrice, closePrice, tradeId };
    } finally {
      releaseMutex();
    }
  }

  async getBalance(): Promise<{ demo: number; live: number }> {
    if (this.lastBalance) {
      return this.isDemo ? { demo: this.lastBalance.balance, live: 0 } : { demo: 0, live: this.lastBalance.balance };
    }
    return { demo: 0, live: 0 };
  }

  async getTradeHistory(): Promise<PocketOptionTrade[]> {
    this.getBalances();
    try {
      const deals = await this.waitForEvent<any[]>("updateClosedDeals", 3000);
      return deals.map((d) => ({
        id: String(d.id || d.deal_id || ""),
        asset: String(d.asset || d.symbol || ""),
        direction: String(d.direction || d.action || "").toLowerCase() === "call" ? "CALL" : "PUT",
        amount: Number(d.amount || 0),
        profit: Number(d.profit || 0),
        openPrice: Number(d.open_price || 0),
        closePrice: Number(d.close_price || 0),
        openTime: Number(d.open_time || 0),
        closeTime: Number(d.close_time || 0),
        result: Number(d.profit || 0) > 0 ? "WIN" : "LOSS",
      }));
    } catch {
      return [];
    }
  }

  // ============ Event Callbacks (Legacy Adapters) ============

  onCandle(asset: string, callback: (candle: CandleData) => void, size = 60): () => void {
    if (!this.candleListeners.has(asset)) this.candleListeners.set(asset, []);
    this.candleListeners.get(asset)!.push(callback);
    this.activeSubscriptions.set(`${asset}:${size}`, { asset, size });
    if (this.state === ConnectionState.READY) this.changeSymbol(asset, size);
    return () => {
      const listeners = this.candleListeners.get(asset);
      if (listeners) {
        const idx = listeners.indexOf(callback);
        if (idx >= 0) listeners.splice(idx, 1);
      }
    };
  }

  onAuth(callback: () => void): () => void {
    this.onAuthCallbacks.push(callback);
    return () => { this.onAuthCallbacks = this.onAuthCallbacks.filter((cb) => cb !== callback); };
  }

  onBalance(callback: (balance: { balance: number; isDemo: number }) => void): () => void {
    this.onBalanceCallbacks.push(callback);
    return () => { this.onBalanceCallbacks = this.onBalanceCallbacks.filter((cb) => cb !== callback); };
  }

  onError(callback: (error: Error) => void): () => void {
    this.onErrorCallbacks.push(callback);
    return () => { this.onErrorCallbacks = this.onErrorCallbacks.filter((cb) => cb !== callback); };
  }

  onSsidExpired(callback: () => void): () => void {
    this.onSsidExpiredCallbacks.push(callback);
    return () => { this.onSsidExpiredCallbacks = this.onSsidExpiredCallbacks.filter((cb) => cb !== callback); };
  }

  private parseIsDemoFromSsid(): boolean {
    try {
      const match = this.ssid.match(/"isDemo"\s*:\s*(\d)/);
      if (match) return match[1] === "1";
    } catch {}
    return true;
  }
}
