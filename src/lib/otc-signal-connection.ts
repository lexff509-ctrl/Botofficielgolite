/**
 * OTC Signal Connection — Fix #7
 *
 * Manages a WebSocket connection to an external OTC signal provider.
 *
 * Features:
 *  - Connection pooling (one shared connection per endpoint)
 *  - Automatic reconnection with exponential backoff
 *  - Signal deduplication via a TTL-based seen-ID set
 *  - Signal validation (schema + staleness check)
 *  - Typed event emission for downstream consumers
 *
 * Usage:
 *   const conn = OtcSignalConnectionPool.getOrCreate(config);
 *   conn.on("signal", (signal) => { ... });
 *   await conn.connect();
 *   // later:
 *   conn.disconnect();
 */

import { EventEmitter } from "events";
import type { Signal, OtcSignalRaw, OtcConnectionConfig, TimeframeSeconds } from "@/types/trading";
import { createLogger } from "@/lib/logger";
import { ExponentialBackoff, sleep } from "@/lib/backoff";
import { v4 as uuidv4 } from "uuid";

const log = createLogger("OtcSignalConnection");

// ─── Validation helpers ───────────────────────────────────────────────────────

const VALID_DIRECTIONS = new Set(["call", "put"]);
const VALID_TIMEFRAMES = new Set([5, 10, 15, 30, 60, 120, 300]);

function isValidRawSignal(raw: unknown): raw is OtcSignalRaw {
  if (!raw || typeof raw !== "object") return false;
  const r = raw as Record<string, unknown>;
  return (
    typeof r.id === "string" &&
    r.id.length > 0 &&
    typeof r.asset === "string" &&
    r.asset.length > 0 &&
    VALID_DIRECTIONS.has(r.direction as string) &&
    VALID_TIMEFRAMES.has(r.timeframe as number) &&
    typeof r.timestamp === "number" &&
    r.timestamp > 0 &&
    typeof r.confidence === "number" &&
    r.confidence >= 0 &&
    r.confidence <= 1
  );
}

function rawToSignal(raw: OtcSignalRaw, ttlSeconds: number): Signal {
  return {
    id: uuidv4(),
    symbol: raw.asset,
    direction: raw.direction,
    timeframe: raw.timeframe as TimeframeSeconds,
    generatedAt: raw.timestamp,
    expiresAt: raw.timestamp + ttlSeconds,
    confidence: raw.confidence,
    source: "otc",
    indicators: {},
  };
}

// ─── Deduplication set ────────────────────────────────────────────────────────

class SeenIdSet {
  private readonly _ids = new Map<string, number>(); // id → expiry timestamp (ms)
  private readonly _ttlMs: number;

  constructor(ttlMs: number) {
    this._ttlMs = ttlMs;
  }

  has(id: string): boolean {
    this._evict();
    return this._ids.has(id);
  }

  add(id: string): void {
    this._ids.set(id, Date.now() + this._ttlMs);
  }

  private _evict(): void {
    const now = Date.now();
    for (const [id, expiry] of this._ids) {
      if (expiry <= now) this._ids.delete(id);
    }
  }
}

// ─── Connection ───────────────────────────────────────────────────────────────

export type OtcSignalConnectionEvents = {
  signal: [signal: Signal];
  connected: [];
  disconnected: [reason: string];
  error: [err: Error];
};

export class OtcSignalConnection extends EventEmitter {
  private readonly _config: OtcConnectionConfig;
  private _ws: import("ws").WebSocket | null = null;
  private _connected = false;
  private _stopped = false;
  private _backoff: ExponentialBackoff;
  private _seenIds: SeenIdSet;
  private _reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(config: OtcConnectionConfig) {
    super();
    this._config = config;
    this._backoff = new ExponentialBackoff({
      baseDelayMs: config.reconnectBaseDelayMs,
      maxDelayMs: config.reconnectMaxDelayMs,
      maxAttempts: config.reconnectMaxAttempts,
    });
    // Dedup window = 2× signal TTL
    this._seenIds = new SeenIdSet(config.signalTtlSeconds * 2 * 1_000);
  }

  get isConnected(): boolean {
    return this._connected;
  }

  // ─── Lifecycle ─────────────────────────────────────────────────────────────

  async connect(): Promise<void> {
    this._stopped = false;
    this._backoff.reset();
    await this._connectOnce();
  }

  disconnect(): void {
    this._stopped = true;
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
    this._closeSocket("client disconnect");
  }

  // ─── Internals ─────────────────────────────────────────────────────────────

  private async _connectOnce(): Promise<void> {
    const { WebSocket } = await import("ws");

    const url = this._buildUrl();
    log.info("OTC: connecting", { url: this._config.endpoint });

    const ws = new WebSocket(url);
    this._ws = ws;

    ws.on("open", () => {
      log.info("OTC: WebSocket open");
      this._connected = true;
      this._backoff.reset();
      this.emit("connected");
    });

    ws.on("message", (raw: Buffer | string) => {
      this._handleMessage(raw.toString());
    });

    ws.on("close", (code, reason) => {
      const msg = reason?.toString() ?? "unknown";
      log.warn("OTC: WebSocket closed", { code, reason: msg });
      this._connected = false;
      this.emit("disconnected", msg);
      if (!this._stopped) {
        this._scheduleReconnect();
      }
    });

    ws.on("error", (err) => {
      log.error("OTC: WebSocket error", err);
      this.emit("error", err instanceof Error ? err : new Error(String(err)));
      // close event will follow and trigger reconnect
    });
  }

  private _buildUrl(): string {
    const base = this._config.endpoint;
    if (this._config.apiKey) {
      const sep = base.includes("?") ? "&" : "?";
      return `${base}${sep}apiKey=${encodeURIComponent(this._config.apiKey)}`;
    }
    return base;
  }

  private _handleMessage(raw: string): void {
    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch {
      log.warn("OTC: received non-JSON message", { raw: raw.slice(0, 200) });
      return;
    }

    // Support both single signal and array of signals
    const items: unknown[] = Array.isArray(data) ? data : [data];

    for (const item of items) {
      this._processRawSignal(item);
    }
  }

  private _processRawSignal(raw: unknown): void {
    if (!isValidRawSignal(raw)) {
      log.debug("OTC: invalid or unrecognised signal payload", { raw });
      return;
    }

    // Staleness check
    const nowSec = Math.floor(Date.now() / 1_000);
    if (raw.timestamp + this._config.signalTtlSeconds < nowSec) {
      log.debug("OTC: discarding stale signal", {
        id: raw.id,
        age: nowSec - raw.timestamp,
      });
      return;
    }

    // Deduplication
    if (this._seenIds.has(raw.id)) {
      log.debug("OTC: duplicate signal discarded", { id: raw.id });
      return;
    }
    this._seenIds.add(raw.id);

    const signal = rawToSignal(raw, this._config.signalTtlSeconds);
    log.info("OTC: valid signal received", {
      symbol: signal.symbol,
      direction: signal.direction,
      confidence: signal.confidence,
    });
    this.emit("signal", signal);
  }

  private _scheduleReconnect(): void {
    if (this._backoff.exhausted) {
      log.error("OTC: max reconnection attempts reached — giving up");
      return;
    }

    const delay = this._backoff.nextDelayMs();
    if (delay === null) return;

    log.info(`OTC: reconnecting in ${delay}ms`, {
      attempt: this._backoff.attempt,
      max: this._backoff.maxAttempts,
    });

    this._reconnectTimer = setTimeout(async () => {
      this._reconnectTimer = null;
      if (!this._stopped) {
        await this._connectOnce();
      }
    }, delay);
  }

  private _closeSocket(reason: string): void {
    if (this._ws) {
      try {
        this._ws.close(1000, reason);
      } catch {
        try {
          this._ws.terminate();
        } catch {
          // ignore
        }
      }
      this._ws = null;
    }
    this._connected = false;
  }
}

// ─── Connection pool ──────────────────────────────────────────────────────────

/**
 * Singleton pool — one connection per endpoint URL.
 * Prevents multiple connections to the same OTC provider.
 */
export class OtcSignalConnectionPool {
  private static readonly _pool = new Map<string, OtcSignalConnection>();

  static getOrCreate(config: OtcConnectionConfig): OtcSignalConnection {
    const key = config.endpoint;
    let conn = OtcSignalConnectionPool._pool.get(key);
    if (!conn) {
      conn = new OtcSignalConnection(config);
      OtcSignalConnectionPool._pool.set(key, conn);
      log.info("OTC: created new connection in pool", { endpoint: key });
    }
    return conn;
  }

  static get(endpoint: string): OtcSignalConnection | undefined {
    return OtcSignalConnectionPool._pool.get(endpoint);
  }

  static async disconnectAll(): Promise<void> {
    for (const [key, conn] of OtcSignalConnectionPool._pool) {
      conn.disconnect();
      OtcSignalConnectionPool._pool.delete(key);
      log.info("OTC: disconnected pool entry", { endpoint: key });
    }
  }

  /** Visible for testing */
  static _clear(): void {
    OtcSignalConnectionPool._pool.clear();
  }
}

// ─── Default OTC config ───────────────────────────────────────────────────────

export const DEFAULT_OTC_CONFIG: OtcConnectionConfig = {
  endpoint:
    process.env.OTC_SIGNAL_ENDPOINT ?? "wss://signals.example.com/otc",
  apiKey: process.env.OTC_SIGNAL_API_KEY,
  reconnectBaseDelayMs: 1_000,
  reconnectMaxDelayMs: 30_000,
  reconnectMaxAttempts: 15,
  signalTtlSeconds: 300,
};

// Re-export sleep for convenience
export { sleep };
