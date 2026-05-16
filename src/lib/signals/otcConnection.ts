import { EventEmitter } from "events";
import { SignalPayload } from "../bot/types";

export type OTCConnectionStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "disconnected"
  | "error";

export interface OTCConfig {
  /** WebSocket endpoint for the OTC signal feed */
  url: string;
  /** Bearer token or API key sent in the connection handshake */
  apiKey?: string;
  /** Milliseconds before a connection attempt times out */
  connectionTimeoutMs: number;
  /** Base delay for exponential back-off reconnection */
  reconnectBaseDelayMs: number;
  /** Maximum delay cap for reconnection back-off */
  reconnectMaxDelayMs: number;
  /** Maximum consecutive reconnect attempts before emitting "error" */
  maxReconnectAttempts: number;
  /** Interval between keep-alive pings */
  pingIntervalMs: number;
  /** How long to wait for a pong before declaring the connection dead */
  pongTimeoutMs: number;
}

export const DEFAULT_OTC_CONFIG: Omit<OTCConfig, "url"> = {
  connectionTimeoutMs: 20_000,
  reconnectBaseDelayMs: 1_500,
  reconnectMaxDelayMs: 45_000,
  maxReconnectAttempts: 15,
  pingIntervalMs: 30_000,
  pongTimeoutMs: 12_000,
};

/**
 * OTCConnection manages a persistent WebSocket connection to the OTC signal
 * feed. It emits:
 *  - "signal"       — a validated SignalPayload is ready
 *  - "statusChange" — OTCConnectionStatus changed
 *  - "error"        — non-fatal error (connection continues / retries)
 */
export class OTCConnection extends EventEmitter {
  private _ws: WebSocket | null = null;
  private _status: OTCConnectionStatus = "idle";
  private _config: OTCConfig;
  private _reconnectAttempts = 0;
  private _reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private _pingTimer: ReturnType<typeof setInterval> | null = null;
  private _pongWatchdog: ReturnType<typeof setTimeout> | null = null;
  private _connectionTimer: ReturnType<typeof setTimeout> | null = null;
  private _destroyed = false;
  private _connectLock = false;

  constructor(config: OTCConfig) {
    super();
    this._config = { ...DEFAULT_OTC_CONFIG, ...config };
  }

  // ─── Public API ─────────────────────────────────────────────────────────────

  get status(): OTCConnectionStatus {
    return this._status;
  }

  get isConnected(): boolean {
    return this._status === "connected";
  }

  /**
   * Start the OTC connection. Idempotent — safe to call when already
   * connecting or connected.
   */
  connect(): void {
    if (this._destroyed) {
      throw new Error("OTCConnection has been destroyed");
    }
    if (this._connectLock || this._status === "connected") return;
    this._initiateConnect();
  }

  /** Gracefully close and stop all timers. Does not trigger reconnection. */
  disconnect(): void {
    this._destroyed = true;
    this._cancelReconnect();
    this._stopPing();
    this._clearConnectionTimer();
    this._closeSocket(1000, "Client disconnect");
    this._setStatus("disconnected");
  }

  /** Permanently destroy — alias for disconnect + removeAllListeners. */
  destroy(): void {
    this.disconnect();
    this.removeAllListeners();
  }

  // ─── Internal helpers ────────────────────────────────────────────────────────

  private _initiateConnect(): void {
    if (this._connectLock) return;
    this._connectLock = true;
    this._setStatus("connecting");
    this._clearConnectionTimer();

    // Connection timeout guard
    this._connectionTimer = setTimeout(() => {
      this._connectLock = false;
      this._emitError(
        new Error(`OTC connection timed out after ${this._config.connectionTimeoutMs}ms`)
      );
      this._closeSocket(1001, "Connection timeout");
      this._scheduleReconnect();
    }, this._config.connectionTimeoutMs);

    try {
      const headers: Record<string, string> = {};
      if (this._config.apiKey) {
        headers["Authorization"] = `Bearer ${this._config.apiKey}`;
      }

      // WebSocket does not support custom headers in browsers; the API key
      // is sent as a query parameter as a fallback for browser environments.
      const url = this._config.apiKey
        ? `${this._config.url}?apiKey=${encodeURIComponent(this._config.apiKey)}`
        : this._config.url;

      this._ws = new WebSocket(url);
    } catch (err) {
      this._connectLock = false;
      this._clearConnectionTimer();
      this._emitError(err instanceof Error ? err : new Error(String(err)));
      this._scheduleReconnect();
      return;
    }

    this._ws.onopen = () => {
      this._connectLock = false;
      this._clearConnectionTimer();
      this._reconnectAttempts = 0;
      this._setStatus("connected");
      this._startPing();
    };

    this._ws.onmessage = (event) => {
      this._resetPongWatchdog();
      this._handleMessage(event.data as string);
    };

    this._ws.onerror = () => {
      this._connectLock = false;
      this._clearConnectionTimer();
      this._emitError(new Error("OTC WebSocket error"));
    };

    this._ws.onclose = (event) => {
      this._connectLock = false;
      this._clearConnectionTimer();
      this._stopPing();

      if (!this._destroyed) {
        this._setStatus("reconnecting");
        this._scheduleReconnect();
      }
    };
  }

  private _handleMessage(raw: string): void {
    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch {
      // Ignore non-JSON frames (e.g. plain-text pong)
      return;
    }

    if (!data || typeof data !== "object") return;
    const msg = data as Record<string, unknown>;

    // Handle pong frames
    if (msg.type === "pong") return;

    // Validate and emit signal payloads
    if (msg.type === "signal" && this._isValidSignal(msg.payload)) {
      this.emit("signal", msg.payload as SignalPayload);
      return;
    }

    // Emit raw messages for other consumers
    this.emit("message", data);
  }

  private _isValidSignal(payload: unknown): payload is SignalPayload {
    if (!payload || typeof payload !== "object") return false;
    const p = payload as Record<string, unknown>;
    return (
      typeof p.asset === "string" &&
      (p.direction === "CALL" || p.direction === "PUT") &&
      typeof p.duration === "number" &&
      typeof p.confidence === "number" &&
      (p.source === "OTC" || p.source === "STANDARD") &&
      typeof p.timestamp === "number"
    );
  }

  private _scheduleReconnect(): void {
    if (this._destroyed) return;
    if (this._reconnectAttempts >= this._config.maxReconnectAttempts) {
      this._setStatus("error");
      this._emitError(
        new Error(
          `OTC: max reconnect attempts (${this._config.maxReconnectAttempts}) reached`
        )
      );
      return;
    }

    this._cancelReconnect();

    const base = Math.min(
      this._config.reconnectBaseDelayMs * 2 ** this._reconnectAttempts,
      this._config.reconnectMaxDelayMs
    );
    const delay = base + Math.random() * 1_500;
    this._reconnectAttempts++;

    this._reconnectTimer = setTimeout(() => {
      if (!this._destroyed) {
        this._initiateConnect();
      }
    }, delay);
  }

  private _cancelReconnect(): void {
    if (this._reconnectTimer !== null) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
  }

  private _startPing(): void {
    this._stopPing();
    this._pingTimer = setInterval(() => {
      if (this._ws?.readyState === WebSocket.OPEN) {
        try {
          this._ws.send(JSON.stringify({ type: "ping", timestamp: Date.now() }));
          this._resetPongWatchdog();
        } catch {
          // Socket may have closed between the check and the send
        }
      }
    }, this._config.pingIntervalMs);
  }

  private _resetPongWatchdog(): void {
    if (this._pongWatchdog !== null) clearTimeout(this._pongWatchdog);
    this._pongWatchdog = setTimeout(() => {
      this._emitError(new Error("OTC pong timeout — connection appears dead"));
      this._closeSocket(1001, "Pong timeout");
      if (!this._destroyed) {
        this._setStatus("reconnecting");
        this._scheduleReconnect();
      }
    }, this._config.pongTimeoutMs);
  }

  private _stopPing(): void {
    if (this._pingTimer !== null) {
      clearInterval(this._pingTimer);
      this._pingTimer = null;
    }
    if (this._pongWatchdog !== null) {
      clearTimeout(this._pongWatchdog);
      this._pongWatchdog = null;
    }
  }

  private _clearConnectionTimer(): void {
    if (this._connectionTimer !== null) {
      clearTimeout(this._connectionTimer);
      this._connectionTimer = null;
    }
  }

  private _closeSocket(code: number, reason: string): void {
    if (this._ws) {
      try {
        this._ws.close(code, reason);
      } catch {
        // Already closed
      }
      this._ws = null;
    }
  }

  private _setStatus(status: OTCConnectionStatus): void {
    if (this._status !== status) {
      this._status = status;
      this.emit("statusChange", status);
    }
  }

  private _emitError(err: Error): void {
    this.emit("error", err);
    console.error("[OTCConnection]", err.message);
  }
}

// ─── Singleton factory ────────────────────────────────────────────────────────

let _otcInstance: OTCConnection | null = null;

export function getOTCConnection(config: OTCConfig): OTCConnection {
  const g = globalThis as typeof globalThis & {
    __otcConnection?: OTCConnection;
  };

  if (g.__otcConnection) return g.__otcConnection;

  if (!_otcInstance) {
    _otcInstance = new OTCConnection(config);

    // Ensure unhandled "error" events don't crash the process
    _otcInstance.on("error", (err: Error) => {
      console.error("[OTCConnection] unhandled error:", err.message);
    });

    _otcInstance.on("statusChange", (status: string) => {
      console.info(`[OTCConnection] status → ${status}`);
    });

    _otcInstance.connect();
  }

  g.__otcConnection = _otcInstance;
  return _otcInstance;
}

export async function destroyOTCConnection(): Promise<void> {
  const g = globalThis as typeof globalThis & {
    __otcConnection?: OTCConnection;
  };
  if (g.__otcConnection) {
    g.__otcConnection.destroy();
    g.__otcConnection = undefined;
  }
  _otcInstance = null;
}
