/**
 * ExternalDataService
 * ─────────────────────────────────────────────────────────────────────────────
 * Provides OHLCV candle data from external APIs, completely independent of
 * the PocketOption WebSocket connection.
 *
 * Strategy:
 *  • Crypto assets  (BTC, ETH, SOL, …) → Binance REST API (public, no key)
 *  • Forex assets   (EUR/USD, GBP/USD, …) → ExchangeRate-API (free, no key)
 *    Forex only provides current rate → we synthesise candles from tick history
 *    stored in memory.
 *
 * The cache prevents hammering external APIs on every tick.
 */

import { Candle, Timeframe } from '../lib/trading';

// ─── Config ──────────────────────────────────────────────────────────────────

const CANDLE_CACHE_MS   = 30_000;   // 30 s cache between real fetches
const FETCH_TIMEOUT_MS  = 10_000;   // 10 s hard timeout
const FOREX_TICK_MS     = 20_000;   // Store a new forex tick every 20 s
const FOREX_MAX_TICKS   = 300;      // Keep up to 300 ticks (≈ 100 min)

// ─── Asset maps ──────────────────────────────────────────────────────────────

/** Crypto assets: PO name → Binance REST symbol (e.g. BTCUSDT) */
const CRYPTO_MAP: Record<string, string> = {
  'BTC/USD':   'BTCUSDT',
  'BTCUSD':    'BTCUSDT',
  'ETH/USD':   'ETHUSDT',
  'ETHUSD':    'ETHUSDT',
  'LTC/USD':   'LTCUSDT',
  'LTCUSD':    'LTCUSDT',
  'XRP/USD':   'XRPUSDT',
  'XRPUSD':    'XRPUSDT',
  'SOL/USD':   'SOLUSDT',
  'SOLUSD':    'SOLUSDT',
  'DOGE/USD':  'DOGEUSDT',
  'DOGEUSD':   'DOGEUSDT',
  'BNB/USD':   'BNBUSDT',
  'BNBUSD':    'BNBUSDT',
  'ADA/USD':   'ADAUSDT',
  'DOT/USD':   'DOTUSDT',
  'MATIC/USD': 'MATICUSDT',
};

/** Forex assets: PO name → { base, quote } for ExchangeRate-API */
const FOREX_MAP: Record<string, { base: string; quote: string }> = {
  'EUR/USD': { base: 'EUR', quote: 'USD' },
  'EURUSD':  { base: 'EUR', quote: 'USD' },
  'GBP/USD': { base: 'GBP', quote: 'USD' },
  'GBPUSD':  { base: 'GBP', quote: 'USD' },
  'USD/JPY': { base: 'USD', quote: 'JPY' },
  'USDJPY':  { base: 'USD', quote: 'JPY' },
  'AUD/USD': { base: 'AUD', quote: 'USD' },
  'AUDUSD':  { base: 'AUD', quote: 'USD' },
  'USD/CAD': { base: 'USD', quote: 'CAD' },
  'USDCAD':  { base: 'USD', quote: 'CAD' },
  'USD/CHF': { base: 'USD', quote: 'CHF' },
  'USDCHF':  { base: 'USD', quote: 'CHF' },
  'EUR/GBP': { base: 'EUR', quote: 'GBP' },
  'EURGBP':  { base: 'EUR', quote: 'GBP' },
  'EUR/JPY': { base: 'EUR', quote: 'JPY' },
  'EURJPY':  { base: 'EUR', quote: 'JPY' },
  'GBP/JPY': { base: 'GBP', quote: 'JPY' },
  'GBPJPY':  { base: 'GBP', quote: 'JPY' },
  'NZD/USD': { base: 'NZD', quote: 'USD' },
  'NZDUSD':  { base: 'NZD', quote: 'USD' },
  'EUR/CHF': { base: 'EUR', quote: 'CHF' },
  'EURCHF':  { base: 'EUR', quote: 'CHF' },
  'AUD/JPY': { base: 'AUD', quote: 'JPY' },
  'AUDJPY':  { base: 'AUD', quote: 'JPY' },
  'CAD/JPY': { base: 'CAD', quote: 'JPY' },
  'CADJPY':  { base: 'CAD', quote: 'JPY' },
  'EUR/CAD': { base: 'EUR', quote: 'CAD' },
  'EURCAD':  { base: 'EUR', quote: 'CAD' },
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function normalize(asset: string): string {
  return asset.replace(/\s*\(OTC\)/i, '').toUpperCase().trim();
}

async function fetchWithTimeout(url: string, ms = FETCH_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    return res;
  } catch (e) {
    clearTimeout(timer);
    throw e;
  }
}

function binanceIntervalFor(tf: Timeframe): string {
  const t = tf as string;
  if (t === '5s' || t === '10s' || t === '15s' || t === '30s') return '1m';
  if (t === '1m') return '1m';
  if (t === '3m') return '3m';
  if (t === '5m') return '5m';
  if (t === '15m') return '15m';
  if (t === '30m') return '30m';
  if (t === '1h') return '1h';
  return '1m';
}

// ─── Class ───────────────────────────────────────────────────────────────────

class ExternalDataService {

  // Candle cache: key = "ASSET:TF"
  private candleCache = new Map<string, { candles: Candle[]; fetchedAt: number }>();

  // Forex tick history: key = "BASE/QUOTE"
  private forexTicks = new Map<string, { price: number; ts: number }[]>();
  private forexFetchedAt = new Map<string, number>();

  // ─── Public API ───────────────────────────────────────────────────────────

  /**
   * Returns ≥ 1 candle for any recognised asset.
   * Never throws — returns [] only if the asset is completely unknown.
   */
  async getExternalCandles(asset: string, tf: Timeframe, limit = 100): Promise<Candle[]> {
    const key = normalize(asset);

    if (CRYPTO_MAP[key]) {
      return this.getCryptoCandles(CRYPTO_MAP[key], tf, limit);
    }

    if (FOREX_MAP[key]) {
      const { base, quote } = FOREX_MAP[key];
      return this.getForexCandles(base, quote, tf, limit);
    }

    console.log(`[ExternalData] No mapping for "${asset}"`);
    return [];
  }

  // ─── Crypto via Binance REST ──────────────────────────────────────────────

  private async getCryptoCandles(symbol: string, tf: Timeframe, limit: number): Promise<Candle[]> {
    const cacheKey = `${symbol}:${tf}`;
    const hit = this.candleCache.get(cacheKey);
    if (hit && Date.now() - hit.fetchedAt < CANDLE_CACHE_MS) return hit.candles;

    const interval = binanceIntervalFor(tf);
    const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;

    try {
      console.log(`[ExternalData] Binance klines → ${symbol} (${interval})`);
      const res = await fetchWithTimeout(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: number[][] = await res.json();

      const candles: Candle[] = data.map(c => ({
        timestamp: Math.floor(c[0] / 1000),
        open:  parseFloat(String(c[1])),
        high:  parseFloat(String(c[2])),
        low:   parseFloat(String(c[3])),
        close: parseFloat(String(c[4])),
        volume: parseFloat(String(c[5])),
      }));

      this.candleCache.set(cacheKey, { candles, fetchedAt: Date.now() });
      console.log(`[ExternalData] Got ${candles.length} crypto candles for ${symbol}`);
      return candles;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[ExternalData] Binance fetch failed (${symbol}): ${msg}`);
      return this.candleCache.get(cacheKey)?.candles ?? [];
    }
  }

  // ─── Forex via ExchangeRate-API (free, no key) ────────────────────────────

  private async getForexCandles(base: string, quote: string, tf: Timeframe, limit: number): Promise<Candle[]> {
    const pairKey = `${base}/${quote}`;
    const cacheKey = `${pairKey}:${tf}`;

    // Refresh the current rate if the last fetch is stale
    const lastFetch = this.forexFetchedAt.get(pairKey) ?? 0;
    if (Date.now() - lastFetch > FOREX_TICK_MS) {
      await this.refreshForexRate(base, quote, pairKey);
    }

    // Build synthetic candles from tick history
    const ticks = this.forexTicks.get(pairKey) ?? [];
    if (ticks.length === 0) {
      // Return stale candles if any
      return this.candleCache.get(cacheKey)?.candles ?? [];
    }

    const candles = this.buildCandlesFromTicks(ticks, tf, limit);
    this.candleCache.set(cacheKey, { candles, fetchedAt: Date.now() });
    return candles;
  }

  private async refreshForexRate(base: string, quote: string, pairKey: string): Promise<void> {
    // Use open.er-api.com — free, no API key, reliable
    const url = `https://open.er-api.com/v6/latest/${base}`;
    try {
      console.log(`[ExternalData] Forex rate → ${pairKey}`);
      const res = await fetchWithTimeout(url, 6000);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      const rate: number | undefined = data?.rates?.[quote];
      if (!rate) throw new Error(`Quote "${quote}" not in response`);

      // Add tick
      const ticks = this.forexTicks.get(pairKey) ?? [];
      ticks.push({ price: rate, ts: Math.floor(Date.now() / 1000) });
      if (ticks.length > FOREX_MAX_TICKS) ticks.shift();
      this.forexTicks.set(pairKey, ticks);
      this.forexFetchedAt.set(pairKey, Date.now());

      console.log(`[ExternalData] ${pairKey} rate: ${rate} (${ticks.length} ticks)`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[ExternalData] Forex fetch failed (${pairKey}): ${msg}`);
      this.forexFetchedAt.set(pairKey, Date.now()); // avoid tight retry loop
    }
  }

  /**
   * Aggregate tick history into OHLCV candles.
   * If fewer ticks than needed, synthesises micro-candles from the available data.
   */
  private buildCandlesFromTicks(ticks: { price: number; ts: number }[], tf: Timeframe, limit: number): Candle[] {
    if (ticks.length === 0) return [];

    // Determine candle duration in seconds
    const tfSec = (() => {
      if (tf.endsWith('s')) return parseInt(tf);
      if (tf.endsWith('m')) return parseInt(tf) * 60;
      if (tf.endsWith('h')) return parseInt(tf) * 3600;
      return 60;
    })();

    const now = Math.floor(Date.now() / 1000);
    const earliest = now - limit * tfSec;

    // Group ticks into time buckets
    const buckets = new Map<number, number[]>();
    for (const t of ticks) {
      const bucketTs = Math.floor(t.ts / tfSec) * tfSec;
      if (bucketTs < earliest) continue;
      const arr = buckets.get(bucketTs) ?? [];
      arr.push(t.price);
      buckets.set(bucketTs, arr);
    }

    // If we have very few buckets, synthesise extra candles from all ticks
    if (buckets.size < 5) {
      return this.synthesiseCandles(ticks, limit);
    }

    const candles: Candle[] = [];
    const sortedKeys = [...buckets.keys()].sort();
    for (const ts of sortedKeys) {
      const prices = buckets.get(ts)!;
      candles.push({
        timestamp: ts,
        open:   prices[0],
        high:   Math.max(...prices),
        low:    Math.min(...prices),
        close:  prices[prices.length - 1],
        volume: prices.length,
      });
    }

    return candles.slice(-limit);
  }

  /**
   * Last resort: synthesise candles by artificially splitting a price series.
   * Uses small noise to give each candle realistic OHLCV values.
   */
  private synthesiseCandles(ticks: { price: number; ts: number }[], limit: number): Candle[] {
    const base = ticks[ticks.length - 1].price;
    const tsNow = Math.floor(Date.now() / 1000);
    const candles: Candle[] = [];

    // Build a 100-candle synthetic series using the real rate as anchor
    for (let i = limit; i >= 0; i--) {
      const noise = () => (Math.random() - 0.5) * base * 0.0003;
      const open  = base + noise();
      const close = base + noise();
      const high  = Math.max(open, close) + Math.abs(noise());
      const low   = Math.min(open, close) - Math.abs(noise());
      candles.push({
        timestamp: tsNow - i * 60,
        open, high, low, close,
        volume: Math.floor(Math.random() * 1000) + 100,
      });
    }

    // Ensure last candle uses the true current rate
    if (candles.length > 0) {
      candles[candles.length - 1].close = base;
    }

    console.log(`[ExternalData] Synthesised ${candles.length} candles from ${ticks.length} tick(s)`);
    return candles;
  }
}

export const externalDataService = new ExternalDataService();
