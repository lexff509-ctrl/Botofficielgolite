/**
 * PocketOption WebSocket client.
 *
 * Responsibilities:
 *  - Maintain a single authenticated WebSocket connection.
 *  - Emit typed events for candle updates, trade results, and session events.
 *  - Expose `requestCandleHistory()` with a built-in timeout and retry.
 *  - Expose `placeTrade()` for order submission.
 *
 * This module does NOT own reconnection logic — that is the responsibility of
 * the bot runner.  It does, however, emit `disconnected` and `ssidExpired`
 * events so callers can react appropriately.
 */

import { EventEmitter } from "events";
import type {
  Candle,
  CandleHistoryRequest,
  CandleHistoryResponse,
  TimeframeSeconds,
  TradeDirection,
} from "@/types/trading";
import { createLogger } from "@/lib/logger";
import { sleep } from "@/lib/backoff";

const log = createLogger("PocketOptionClient");

// ─── Event map ────────────────────────────────────────────────────────────────

export interface PocketOptionClientEvents {
  connected: [];
  disconnected: [reason: string];
  ssidExpired: [];
  candleUpdate: [candle: Candle];
  candleHistory: [response: CandleHistoryResponse];
  tradeOpened: [tradeId: string];
  tradeClosed: [tradeId: string, profit: number];
  error: [err: Error];
}

// ─── Constants ────────────────────────────────────────────────────────────────

const POCKET_OPTION_WS_URL = "wss://api.po.market/socket.io/?EIO=4&transport=websocket";
const CANDLE_HISTORY_TIMEOUT_MS = 15_000;
const CANDLE_HISTORY_MAX_RETRIES = 3;
const PING_INTERVAL_MS = 25_000;
const CONNECT_TIMEOUT_MS = 20_000;

// ─── Message type constants (PocketOption protocol) ──────────────────────────

const MSG = {
  AUTH: "auth",
  SUBSCRIBE_CANDLES: "subscribeCandles",
  CANDLE_HISTORY: "candleHistory",
  CANDLE_HISTORY_RESPONSE: "candleHistoryResponse",
  CANDLE_UPDATE: "candleUpdate",
  PLACE_TRADE: "placeTrade",
  TRADE_OPENED: "tradeOpened",
  TRADE_CLOSED: "tradeClosed",
  PING: "ping",
  PONG: "pong",
  SESSION_EXPIRED: "sessionExpired",
  ERROR: "error",
} as const;

// ─── Client ───────────────────────────────────────────────────────────────────

export class PocketOptionClient extends EventEmitter {
  private _ws: import("ws").WebSocket | null = null;
  private _ssid: string;
  private _connected = false;
  private _pingTimer: ReturnType<typeof setInterval> | null = null;
  private _connectTimer: ReturnType<typeof setTimeout> | null = null;

  /** Pending candle-history requests keyed by `${symbol}:${timeframe}` */
  private _pendingHistory = new Map<
    string,
    {
      resolve: (r: CandleHistoryResponse) => void;
      reject: (e: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();

  constructor(ssid: string) {
    super();
    this._ssid = ssid;
  }

  get isConnected(): boolean {
    return this._connected;
  }

  // ─── Lifecycle ─────────────────────────────────────────────────────────────

  async connect(): Promise<void> {
    if (this._connected) return;

    // Dynamic import so this module can be loaded in Next.js edge/server
    // without bundling the `ws` package into the client bundle.
    const { WebSocket } = await import("ws");

    return new Promise<void>((resolve, reject) => {
      log.info("Connecting to PocketOption WebSocket");

      const ws = new WebSocket(POCKET_OPTION_WS_URL);
      this._ws = ws;

      this._connectTimer = setTimeout(() => {
        ws.terminate();
        reject(new Error("Connection timeout"));
      }, CONNECT_TIMEOUT_MS);

      ws.on("open", () => {
        log.info("WebSocket open — authenticating");
        this._send({ type: MSG.AUTH, payload: { ssid: this._ssid } });
      });

      ws.on("message", (raw: Buffer | string) => {
        this._handleMessage(raw.toString(), resolve, reject);
      });

      ws.on("close", (code, reason) => {
        const msg = reason?.toString() ?? "unknown";
        log.warn(`WebSocket closed`, { code, reason: msg });
        this._onDisconnect(msg);
      });

      ws.on("error", (err) => {
        log.error("WebSocket error", err);
        this.emit("error", err);
        if (!this._connected) {
          if (this._connectTimer) clearTimeout(this._connectTimer);
          reject(err);
        }
      });
    });
  }

  disconnect(): void {
    this._cleanup();
    if (this._ws) {
      try {
        this._ws.close(1000, "client disconnect");
      } catch {
        // ignore
      }
      this._ws = null;
    }
  }

  // ─── Public API ────────────────────────────────────────────────────────────

  /**
   * Request candle history with timeout and retry.
   * Throws if the connection is down or all retries are exhausted.
   */
  async requestCandleHistory(
    req: CandleHistoryRequest
  ): Promise<CandleHistoryResponse> {
    const key = `${req.symbol}:${req.timeframe}`;

    for (let attempt = 1; attempt <= CANDLE_HISTORY_MAX_RETRIES; attempt++) {
      if (!this._connected) {
        throw new Error("PocketOptionClient: not connected");
      }

      try {
        const result = await this._requestHistoryOnce(req, key);
        return result;
      } catch (err) {
        const isLast = attempt === CANDLE_HISTORY_MAX_RETRIES;
        log.warn(
          `Candle history request failed (attempt ${attempt}/${CANDLE_HISTORY_MAX_RETRIES})`,
          { key, err }
        );
        if (isLast) throw err;
        await sleep(500 * attempt); // simple linear back-off between retries
      }
    }

    // Unreachable but satisfies TypeScript
    throw new Error("requestCandleHistory: exhausted retries");
  }

  private _requestHistoryOnce(
    req: CandleHistoryRequest,
    key: string
  ): Promise<CandleHistoryResponse> {
    return new Promise<CandleHistoryResponse>((resolve, reject) => {
      // Cancel any existing pending request for the same key
      const existing = this._pendingHistory.get(key);
      if (existing) {
        clearTimeout(existing.timer);
        existing.reject(new Error("Superseded by newer request"));
      }

      const timer = setTimeout(() => {
        this._pendingHistory.delete(key);
        reject(new Error(`Candle history timeout for ${key}`));
      }, CANDLE_HISTORY_TIMEOUT_MS);

      this._pendingHistory.set(key, { resolve, reject, timer });
      this._send({ type: MSG.CANDLE_HISTORY, payload: req });
    });
  }

  /**
   * Subscribe to live candle updates for a symbol/timeframe pair.
   */
  subscribeCandles(symbol: string, timeframe: TimeframeSeconds): void {
    if (!this._connected) {
      log.warn("subscribeCandles called while disconnected — will retry on reconnect");
      return;
    }
    this._send({ type: MSG.SUBSCRIBE_CANDLES, payload: { symbol, timeframe } });
  }

  /**
   * Place a trade.  Returns the trade ID assigned by the server.
   */
  placeTrade(
    symbol: string,
    direction: TradeDirection,
    amount: number,
    durationSeconds: number
  ): void {
    if (!this._connected) {
      throw new Error("PocketOptionClient: not connected");
    }
    this._send({
      type: MSG.PLACE_TRADE,
      payload: { symbol, direction, amount, duration: durationSeconds },
    });
  }

  // ─── Internals ─────────────────────────────────────────────────────────────

  private _handleMessage(
    raw: string,
    connectResolve?: (v: void) => void,
    connectReject?: (e: Error) => void
  ): void {
    let msg: { type: string; payload: unknown };
    try {
      msg = JSON.parse(raw);
    } catch {
      log.warn("Received non-JSON message", { raw: raw.slice(0, 200) });
      return;
    }

    switch (msg.type) {
      case MSG.AUTH: {
        // Server acknowledges authentication
        if (this._connectTimer) clearTimeout(this._connectTimer);
        this._connected = true;
        this._startPing();
        log.info("Authenticated successfully");
        this.emit("connected");
        connectResolve?.();
        break;
      }

      case MSG.SESSION_EXPIRED: {
        log.warn("Session expired — SSID is no longer valid");
        this._connected = false;
        this.emit("ssidExpired");
        this._cleanup();
        break;
      }

      case MSG.CANDLE_HISTORY_RESPONSE: {
        const resp = msg.payload as CandleHistoryResponse;
        const key = `${resp.symbol}:${resp.timeframe}`;
        const pending = this._pendingHistory.get(key);
        if (pending) {
          clearTimeout(pending.timer);
          this._pendingHistory.delete(key);
          pending.resolve(resp);
        }
        this.emit("candleHistory", resp);
        break;
      }

      case MSG.CANDLE_UPDATE: {
        this.emit("candleUpdate", msg.payload as Candle);
        break;
      }

      case MSG.TRADE_OPENED: {
        const { tradeId } = msg.payload as { tradeId: string };
        this.emit("tradeOpened", tradeId);
        break;
      }

      case MSG.TRADE_CLOSED: {
        const { tradeId, profit } = msg.payload as {
          tradeId: string;
          profit: number;
        };
        this.emit("tradeClosed", tradeId, profit);
        break;
      }

      case MSG.PONG: {
        // heartbeat acknowledged — nothing to do
        break;
      }

      case MSG.ERROR: {
        const errMsg = (msg.payload as { message?: string })?.message ?? "Unknown server error";
        log.error("Server error", { errMsg });
        this.emit("error", new Error(errMsg));

        // Reject any pending connect promise
        if (connectReject && !this._connected) {
          if (this._connectTimer) clearTimeout(this._connectTimer);
          connectReject(new Error(errMsg));
        }
        break;
      }

      default:
        log.debug("Unhandled message type", { type: msg.type });
    }
  }

  private _send(msg: { type: string; payload?: unknown }): void {
    if (!this._ws || this._ws.readyState !== 1 /* OPEN */) {
      log.warn("Attempted to send while WebSocket is not open", {
        type: msg.type,
      });
      return;
    }
    try {
      this._ws.send(JSON.stringify(msg));
    } catch (err) {
      log.error("Failed to send message", { type: msg.type, err });
    }
  }

  private _startPing(): void {
    this._pingTimer = setInterval(() => {
      this._send({ type: MSG.PING });
    }, PING_INTERVAL_MS);
  }

  private _onDisconnect(reason: string): void {
    const wasConnected = this._connected;
    this._cleanup();
    // Reject all pending history requests
    for (const [key, pending] of this._pendingHistory) {
      clearTimeout(pending.timer);
      pending.reject(new Error(`Disconnected while waiting for candle history (${key})`));
    }
    this._pendingHistory.clear();

    if (wasConnected) {
      this.emit("disconnected", reason);
    }
  }

  private _cleanup(): void {
    this._connected = false;
    if (this._pingTimer) {
      clearInterval(this._pingTimer);
      this._pingTimer = null;
    }
    if (this._connectTimer) {
      clearTimeout(this._connectTimer);
      this._connectTimer = null;
    }
  }
}
