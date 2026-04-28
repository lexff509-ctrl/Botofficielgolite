// Candle Cache - Accumulates real-time candle data from PocketOption
// Singleton that maintains an in-memory store of OHLCV candles per asset/timeframe

import type { Candle, Timeframe } from "./trading";
import { TIMEFRAMES } from "./trading";

export interface CandleData {
  asset: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  timestamp: number;
}

const MAX_CANDLES_PER_KEY = 500;

function tfToSeconds(tf: Timeframe): number {
  if (tf.endsWith("s")) return parseInt(tf);
  if (tf.endsWith("m")) return parseInt(tf) * 60;
  return 60;
}

function aggregateCandles(candles: Candle[], factor: number): Candle[] {
  if (factor <= 1) return candles;
  const result: Candle[] = [];
  for (let i = 0; i < candles.length; i += factor) {
    const chunk = candles.slice(i, i + factor);
    if (chunk.length === 0) continue;
    result.push({
      open: chunk[0].open,
      high: Math.max(...chunk.map((c) => c.high)),
      low: Math.min(...chunk.map((c) => c.low)),
      close: chunk[chunk.length - 1].close,
      volume: chunk.reduce((a, c) => a + c.volume, 0),
      timestamp: chunk[0].timestamp,
    });
  }
  return result;
}

class CandleCache {
  private store = new Map<string, Candle[]>();
  private unsubFns = new Map<string, () => void>();
  private subRefCount = new Map<string, number>();
  private clientRef: { onCandle: (asset: string, cb: (c: CandleData) => void) => () => void } | null = null;

  setClient(client: { onCandle: (asset: string, cb: (c: CandleData) => void) => () => void }): void {
    this.clientRef = client;
  }

  clear(): void {
    for (const [, fn] of this.unsubFns) {
      try { fn(); } catch {}
    }
    this.unsubFns.clear();
    this.subRefCount.clear();
    this.store.clear();
    this.clientRef = null;
  }

  subscribe(asset: string, size: number): void {
    const key = `${asset}:${size}`;
    const count = this.subRefCount.get(key) || 0;
    this.subRefCount.set(key, count + 1);
    if (count > 0) return;
    if (!this.store.has(key)) {
      this.store.set(key, []);
    }
    if (this.clientRef) {
      const unsub = this.clientRef.onCandle(asset, (candle: CandleData) => {
        this.handleCandle(key, candle);
      });
      this.unsubFns.set(key, unsub);
    }
  }

  unsubscribe(asset: string, size: number): void {
    const key = `${asset}:${size}`;
    const count = this.subRefCount.get(key) || 0;
    if (count <= 1) {
      const unsub = this.unsubFns.get(key);
      if (unsub) { try { unsub(); } catch {} }
      this.unsubFns.delete(key);
      this.subRefCount.delete(key);
    } else {
      this.subRefCount.set(key, count - 1);
    }
  }

  getCandles(asset: string, size: number, count: number): Candle[] {
    const key = `${asset}:${size}`;
    const candles = this.store.get(key) || [];
    return candles.slice(-count);
  }

  getCandlesForTimeframe(asset: string, tf: Timeframe, count: number): Candle[] {
    const targetSec = tfToSeconds(tf);
    const baseSec = 60;
    if (targetSec >= baseSec) {
      const factor = Math.round(targetSec / baseSec);
      const baseCandles = this.getCandles(asset, baseSec, count * factor + factor);
      if (baseCandles.length < count * factor) return baseCandles;
      const aggregated = aggregateCandles(baseCandles, factor);
      return aggregated.slice(-count);
    }
    return this.getCandles(asset, targetSec, count);
  }

  getStatus(): Record<string, number> {
    const status: Record<string, number> = {};
    for (const [key, candles] of this.store) {
      status[key] = candles.length;
    }
    return status;
  }

  private handleCandle(key: string, candle: CandleData): void {
    const arr = this.store.get(key);
    if (!arr) return;
    const newCandle: Candle = {
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
      volume: candle.volume,
      timestamp: candle.timestamp,
    };
    if (arr.length > 0 && arr[arr.length - 1].timestamp === candle.timestamp) {
      arr[arr.length - 1] = newCandle;
    } else {
      arr.push(newCandle);
      if (arr.length > MAX_CANDLES_PER_KEY) {
        arr.splice(0, arr.length - MAX_CANDLES_PER_KEY);
      }
    }
  }

  // Seed historical candles (used for bootstrap when starting a bot)
  seedCandles(asset: string, size: number, historicalData: CandleData[]): void {
    const key = `${asset}:${size}`;
    if (!this.store.has(key)) {
      this.store.set(key, []);
    }
    const arr = this.store.get(key)!;
    for (const candle of historicalData) {
      const newCandle: Candle = {
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
        volume: candle.volume,
        timestamp: candle.timestamp,
      };
      // Insert in order, dedup by timestamp
      if (arr.length > 0 && arr[arr.length - 1].timestamp === candle.timestamp) {
        arr[arr.length - 1] = newCandle;
      } else {
        arr.push(newCandle);
      }
    }
    // Trim to max
    if (arr.length > MAX_CANDLES_PER_KEY) {
      arr.splice(0, arr.length - MAX_CANDLES_PER_KEY);
    }
  }

  resubscribeAll(): void {
    if (!this.clientRef) return;
    for (const [key] of this.subRefCount) {
      const [asset, sizeStr] = key.split(":");
      const size = parseInt(sizeStr);
      const unsub = this.clientRef.onCandle(asset, (candle: CandleData) => {
        this.handleCandle(key, candle);
      });
      this.unsubFns.set(key, unsub);
    }
  }
}

export const candleCache = new CandleCache();
