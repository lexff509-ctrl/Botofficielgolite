import { EventEmitter } from "events";
import { OTCConnection, OTCConfig, getOTCConnection } from "./otcConnection";
import { SignalPayload } from "../bot/types";

/**
 * SignalManager aggregates signals from one or more OTC connections and
 * provides a unified event stream. It also deduplicates signals that arrive
 * within a short window (e.g. from multiple feeds).
 */
export class SignalManager extends EventEmitter {
  private _otc: OTCConnection;
  private _seen = new Map<string, number>();
  private _dedupeWindowMs: number;
  private _cleanupTimer: ReturnType<typeof setInterval>;

  constructor(otcConfig: OTCConfig, dedupeWindowMs = 5_000) {
    super();
    this._dedupeWindowMs = dedupeWindowMs;
    this._otc = getOTCConnection(otcConfig);

    this._otc.on("signal", (signal: SignalPayload) => {
      this._handleSignal(signal);
    });

    this._otc.on("statusChange", (status: string) => {
      this.emit("otcStatus", status);
    });

    this._otc.on("error", (err: Error) => {
      this.emit("error", err);
    });

    // Periodically clean up the deduplication map to prevent memory leaks
    this._cleanupTimer = setInterval(() => {
      const cutoff = Date.now() - this._dedupeWindowMs * 2;
      for (const [key, ts] of this._seen) {
        if (ts < cutoff) this._seen.delete(key);
      }
    }, 60_000);
  }

  private _handleSignal(signal: SignalPayload): void {
    const key = `${signal.asset}:${signal.direction}:${signal.timestamp}`;
    if (this._seen.has(key)) return; // deduplicate
    this._seen.set(key, Date.now());
    this.emit("signal", signal);
  }

  destroy(): void {
    clearInterval(this._cleanupTimer);
    this._otc.destroy();
    this.removeAllListeners();
  }
}
