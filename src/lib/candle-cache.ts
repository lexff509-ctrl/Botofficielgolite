/**
 * In-memory candle cache with pub/sub.
 *
 * Candles are keyed by `${symbol}:${timeframe}`.  Subscribers are notified
 * whenever a new candle is appended or an existing one is updated (e.g. the
 * current live candle).
 *
 * The cache is intentionally kept simple — it is a ring buffer capped at
 * MAX_CANDLES_PER_SERIES per series so memory usage stays bounded.
 */

import type { Candle, TimeframeSeconds } from "@/types/trading";
import { createLogger } from "@/lib/logger";

const log = createLogger("CandleCache");

const MAX_CANDLES_PER_SERIES = 500;

type CandleListener = (candles: Candle[]) => void;

function seriesKey(symbol: string, timeframe: TimeframeSeconds): string {
  return `${symbol}:${timeframe}`;
}

export class CandleCache {
  private readonly _series = new Map<string, Candle[]>();
  private readonly _listeners = new Map<string, Set<CandleListener>>();

  // ─── Write ──────────────────────────────────────────────────────────────────

  /**
   * Bulk-load candles (e.g. from a history response).
   * Existing candles with the same timestamp are replaced.
   */
  loadHistory(candles: Candle[]): void {
    if (candles.length === 0) return;

    // Group by series key
    const groups = new Map<string, Candle[]>();
    for (const c of candles) {
      const key = seriesKey(c.symbol, c.timeframe);
      const group = groups.get(key) ?? [];
      group.push(c);
      groups.set(key, group);
    }

    for (const [key, incoming] of groups) {
      const existing = this._series.get(key) ?? [];
      const merged = this._merge(existing, incoming);
      this._series.set(key, merged);
      log.debug(`Loaded ${incoming.length} candles into ${key}`, {
        total: merged.length,
      });
      this._notify(key);
    }
  }

  /**
   * Upsert a single candle (live tick update).
   * If a candle with the same timestamp already exists it is replaced;
   * otherwise the candle is appended.
   */
  upsert(candle: Candle): void {
    const key = seriesKey(candle.symbol, candle.timeframe);
    const existing = this._series.get(key) ?? [];
    const idx = existing.findIndex((c) => c.timestamp === candle.timestamp);
    if (idx >= 0) {
      existing[idx] = candle;
    } else {
      existing.push(candle);
      // Keep the ring buffer bounded
      if (existing.length > MAX_CANDLES_PER_SERIES) {
        existing.splice(0, existing.length - MAX_CANDLES_PER_SERIES);
      }
    }
    this._series.set(key, existing);
    this._notify(key);
  }

  // ─── Read ───────────────────────────────────────────────────────────────────

  /**
   * Return a snapshot of candles for the given series, sorted ascending by
   * timestamp.  Returns an empty array if the series is unknown.
   */
  get(symbol: string, timeframe: TimeframeSeconds): Candle[] {
    const key = seriesKey(symbol, timeframe);
    return [...(this._series.get(key) ?? [])];
  }

  /**
   * Return the most recent `count` candles for the series.
   */
  getLatest(
    symbol: string,
    timeframe: TimeframeSeconds,
    count: number
  ): Candle[] {
    const all = this.get(symbol, timeframe);
    return all.slice(-count);
  }

  /**
   * Return the timestamp of the most recent candle, or null if the series is
   * empty.
   */
  latestTimestamp(
    symbol: string,
    timeframe: TimeframeSeconds
  ): number | null {
    const all = this._series.get(seriesKey(symbol, timeframe));
    if (!all || all.length === 0) return null;
    return all[all.length - 1].timestamp;
  }

  /** True if the series has at least `minCount` candles. */
  isReady(
    symbol: string,
    timeframe: TimeframeSeconds,
    minCount = 1
  ): boolean {
    const all = this._series.get(seriesKey(symbol, timeframe));
    return (all?.length ?? 0) >= minCount;
  }

  // ─── Subscriptions ──────────────────────────────────────────────────────────

  /**
   * Subscribe to updates for a specific series.
   * Returns an unsubscribe function.
   */
  subscribe(
    symbol: string,
    timeframe: TimeframeSeconds,
    listener: CandleListener
  ): () => void {
    const key = seriesKey(symbol, timeframe);
    const set = this._listeners.get(key) ?? new Set();
    set.add(listener);
    this._listeners.set(key, set);

    // Immediately deliver current snapshot if available
    const current = this._series.get(key);
    if (current && current.length > 0) {
      try {
        listener([...current]);
      } catch (err) {
        log.error("Listener threw during initial delivery", err);
      }
    }

    return () => {
      const s = this._listeners.get(key);
      if (s) {
        s.delete(listener);
        if (s.size === 0) this._listeners.delete(key);
      }
    };
  }

  /**
   * Wait until the series has at least `minCount` candles, or until
   * `timeoutMs` elapses.  Returns true if the condition was met.
   */
  waitUntilReady(
    symbol: string,
    timeframe: TimeframeSeconds,
    minCount = 1,
    timeoutMs = 30_000
  ): Promise<boolean> {
    if (this.isReady(symbol, timeframe, minCount)) return Promise.resolve(true);

    return new Promise<boolean>((resolve) => {
      let timer: ReturnType<typeof setTimeout> | null = null;

      const unsub = this.subscribe(symbol, timeframe, (candles) => {
        if (candles.length >= minCount) {
          if (timer) clearTimeout(timer);
          unsub();
          resolve(true);
        }
      });

      timer = setTimeout(() => {
        unsub();
        resolve(false);
      }, timeoutMs);
    });
  }

  // ─── Internals ──────────────────────────────────────────────────────────────

  private _merge(existing: Candle[], incoming: Candle[]): Candle[] {
    const map = new Map<number, Candle>();
    for (const c of existing) map.set(c.timestamp, c);
    for (const c of incoming) map.set(c.timestamp, c); // incoming wins
    const sorted = [...map.values()].sort((a, b) => a.timestamp - b.timestamp);
    // Trim to ring buffer size
    if (sorted.length > MAX_CANDLES_PER_SERIES) {
      return sorted.slice(sorted.length - MAX_CANDLES_PER_SERIES);
    }
    return sorted;
  }

  private _notify(key: string): void {
    const listeners = this._listeners.get(key);
    if (!listeners || listeners.size === 0) return;
    const snapshot = [...(this._series.get(key) ?? [])];
    for (const fn of listeners) {
      try {
        fn(snapshot);
      } catch (err) {
        log.error(`Listener error for series ${key}`, err);
      }
    }
  }
}

// Singleton shared across the process
export const candleCache = new CandleCache();
