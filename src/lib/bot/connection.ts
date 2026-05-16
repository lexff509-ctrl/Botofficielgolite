import { EventEmitter } from "events";
import { Mutex, withMutex } from "./mutex";
import {
  BotConfig,
  BotStatus,
  DEFAULT_BOT_CONFIG,
  BotEvent,
} from "./types";

/**
 * BotConnection manages the lifecycle of a single WebSocket connection
 * to the bot backend. It handles:
 *  - Mutex-guarded connect/disconnect to prevent race conditions
 *  - Exponential back-off reconnection
 *  - Heartbeat / pong watchdog
 *  - Proper error propagation via EventEmitter
 */
export class BotConnection extends EventEmitter {
  private _ws: WebSocket | null = null;
  private _status: BotStatus = "idle";
  private _config: BotConfig;
  private _mutex = new Mutex();
  private _reconnectAttempts = 0;
  private _reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private _heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private _heartbeatWatchdog: ReturnType<typeof setTimeout> | null = null;
  private _connectionTimer: ReturnType<typeof setTimeout> | null = null;
  private _destroyed = false;

  constructor(
    private readonly _url: string,
    config: Partial<BotConfig> = {}
  ) {
    super();
    this._config = { ...DEFAULT_BOT_CONFIG, ...config };
  }

  // ─── Public API ────────────────────────────────────────────────────────────

  get status(): BotStatus {
    return this._status;
  }

  get isConnected(): boolean {
    return this._status === "connected";
  }

  /** Initiate connection. Safe to call multiple times — mutex prevents races. */
  async connect(): Promise<void> {
    if (this._destroyed) throw new Error("BotConnection has been destroyed");

    await withMutex(this._mutex, async () => {
      if (this._status === "connected" || this._status === "connecting") return;
      await this._doConnect();
    });
  }

  /** Gracefully close the connection and stop all timers. */
  async disconnect(): Promise<void> {
    await withMutex(this._mutex, async () => {
      this._cancelReconnect();
      this._stopHeartbeat();
      this._clearConnectionTimer();
      this._closeSocket(1000, "Client disconnect");
      this._setStatus("disconnected");
    });
  }

  /** Permanently destroy this instance — no further reconnects. */
  async destroy(): Promise<void> {
    this._destroyed = true;
    await this.disconnect();
    this.removeAllListeners();
  }

  // ─── Internal helpers ───────────────────────────────────────────────────────

  private async _doConnect(): Promise<void> {
    this._setStatus("connecting");
    this._clearConnectionTimer();

    return new Promise<void>((resolve, reject) => {
      let settled = false;

      const settle = (err?: Error) => {
        if (settled) return;
        settled = true;
        this._clearConnectionTimer();
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      };

      // Connection timeout guard — prevents hanging indefinitely
      this._connectionTimer = setTimeout(() => {
        settle(new Error(`Connection timed out after ${this._config.connectionTimeoutMs}ms`));
        this._closeSocket(1001, "Connection timeout");
        this._scheduleReconnect();
      }, this._config.connectionTimeoutMs);

      try {
        this._ws = new WebSocket(this._url);
      } catch (err) {
        settle(err instanceof Error ? err : new Error(String(err)));
        this._scheduleReconnect();
        return;
      }

      this._ws.onopen = () => {
        this._reconnectAttempts = 0;
        this._setStatus("connected");
        this._startHeartbeat();
        settle();
        this._emit({ type: "status", payload: "connected", timestamp: Date.now() });
      };

      this._ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data as string);
          // Reset heartbeat watchdog on any incoming message
          this._resetHeartbeatWatchdog();
          this._emit({ type: "message", payload: data, timestamp: Date.now() });
        } catch {
          // Non-JSON frames are silently ignored
        }
      };

      this._ws.onerror = (event) => {
        const err = new Error("WebSocket error");
        this._emit({ type: "error", payload: err, timestamp: Date.now() });
        settle(err);
      };

      this._ws.onclose = (event) => {
        this._stopHeartbeat();
        settle(new Error(`WebSocket closed: code=${event.code}`));

        if (!this._destroyed && this._status !== "disconnected") {
          this._setStatus("reconnecting");
          this._scheduleReconnect();
        }
      };
    });
  }

  private _scheduleReconnect(): void {
    if (this._destroyed) return;
    if (this._reconnectAttempts >= this._config.maxReconnectAttempts) {
      this._setStatus("error");
      this._emit({
        type: "error",
        payload: new Error(
          `Max reconnect attempts (${this._config.maxReconnectAttempts}) reached`
        ),
        timestamp: Date.now(),
      });
      return;
    }

    this._cancelReconnect();

    // Exponential back-off with jitter
    const base = Math.min(
      this._config.reconnectBaseDelayMs * 2 ** this._reconnectAttempts,
      this._config.reconnectMaxDelayMs
    );
    const delay = base + Math.random() * 1_000;
    this._reconnectAttempts++;

    this._reconnectTimer = setTimeout(async () => {
      if (this._destroyed) return;
      try {
        await withMutex(this._mutex, () => this._doConnect());
      } catch {
        // _doConnect already schedules the next reconnect on failure
      }
    }, delay);
  }

  private _cancelReconnect(): void {
    if (this._reconnectTimer !== null) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
  }

  private _startHeartbeat(): void {
    this._stopHeartbeat();
    this._heartbeatTimer = setInterval(() => {
      if (this._ws?.readyState === WebSocket.OPEN) {
        try {
          this._ws.send(JSON.stringify({ type: "ping", timestamp: Date.now() }));
          this._resetHeartbeatWatchdog();
        } catch {
          // Socket may have closed between the check and the send
        }
      }
    }, this._config.heartbeatIntervalMs);
  }

  private _resetHeartbeatWatchdog(): void {
    if (this._heartbeatWatchdog !== null) {
      clearTimeout(this._heartbeatWatchdog);
    }
    this._heartbeatWatchdog = setTimeout(() => {
      // No pong / message received within the watchdog window — treat as dead
      this._closeSocket(1001, "Heartbeat timeout");
      if (!this._destroyed) {
        this._setStatus("reconnecting");
        this._scheduleReconnect();
      }
    }, this._config.heartbeatTimeoutMs);
  }

  private _stopHeartbeat(): void {
    if (this._heartbeatTimer !== null) {
      clearInterval(this._heartbeatTimer);
      this._heartbeatTimer = null;
    }
    if (this._heartbeatWatchdog !== null) {
      clearTimeout(this._heartbeatWatchdog);
      this._heartbeatWatchdog = null;
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

  private _setStatus(status: BotStatus): void {
    if (this._status !== status) {
      this._status = status;
      this.emit("statusChange", status);
    }
  }

  private _emit(event: BotEvent): void {
    this.emit(event.type, event);
  }
}
