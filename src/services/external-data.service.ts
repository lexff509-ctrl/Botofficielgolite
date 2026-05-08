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

const CANDLE_CACHE_MS = 30_000;   // 30 s cache between real fetches
const FETCH_TIMEOUT_MS = 10_000;   // 10 s hard timeout
const FOREX_TICK_MS = 20_000;   // Store a new forex tick every 20 s
const FOREX_MAX_TICKS = 300;      // Keep up to 300 ticks (≈ 100 min)
const TWELVE_DATA_BASE = 'https://api.twelvedata.com';
const TWELVE_DATA_API_KEY = process.env.TWELVE_DATA_API_KEY;

// ─── Asset maps ──────────────────────────────────────────────────────────────

/** Crypto assets: PO name → Binance REST symbol (e.g. BTCUSDT) */
const CRYPTO_MAP: Record<string, string> = {
  'BTC/USD': 'BTCUSDT',
  'BTCUSD': 'BTCUSDT',
  'ETH/USD': 'ETHUSDT',
  'ETHUSD': 'ETHUSDT',
  'LTC/USD': 'LTCUSDT',
  'LTCUSD': 'LTCUSDT',
  'XRP/USD': 'XRPUSDT',
  'XRPUSD': 'XRPUSDT',
  'SOL/USD': 'SOLUSDT',
  'SOLUSD': 'SOLUSDT',
  'DOGE/USD': 'DOGEUSDT',
  'DOGEUSD': 'DOGEUSDT',
  'BNB/USD': 'BNBUSDT',
  'BNBUSD': 'BNBUSDT',
  'ADA/USD': 'ADAUSDT',
  'DOT/USD': 'DOTUSDT',
  'MATIC/USD': 'MATICUSDT',
};

/** Forex assets: PO name → { base, quote } for ExchangeRate-API */
const FOREX_MAP: Record<string, { base: string; quote: string; symbol: string }> = {
  'EUR/USD': { base: 'EUR', quote: 'USD', symbol: 'EUR/USD' },
  'EURUSD': { base: 'EUR', quote: 'USD', symbol: 'EUR/USD' },
  'GBP/USD': { base: 'GBP', quote: 'USD', symbol: 'GBP/USD' },
  'GBPUSD': { base: 'GBP', quote: 'USD', symbol: 'GBP/USD' },
  'USD/JPY': { base: 'USD', quote: 'JPY', symbol: 'USD/JPY' },
  'USDJPY': { base: 'USD', quote: 'JPY', symbol: 'USD/JPY' },
  'AUD/USD': { base: 'AUD', quote: 'USD', symbol: 'AUD/USD' },
  'AUDUSD': { base: 'AUD', quote: 'USD', symbol: 'AUD/USD' },
  'USD/CAD': { base: 'USD', quote: 'CAD', symbol: 'USD/CAD' },
  'USDCAD': { base: 'USD', quote: 'CAD', symbol: 'USD/CAD' },
  'USD/CHF': { base: 'USD', quote: 'CHF', symbol: 'USD/CHF' },
  'USDCHF': { base: 'USD', quote: 'CHF', symbol: 'USD/CHF' },
  'EUR/GBP': { base: 'EUR', quote: 'GBP', symbol: 'EUR/GBP' },
  'EURGBP': { base: 'EUR', quote: 'GBP', symbol: 'EUR/GBP' },
  'EUR/JPY': { base: 'EUR', quote: 'JPY', symbol: 'EUR/JPY' },
  'EURJPY': { base: 'EUR', quote: 'JPY', symbol: 'EUR/JPY' },
  'GBP/JPY': { base: 'GBP', quote: 'JPY', symbol: 'GBP/JPY' },
  'GBPJPY': { base: 'GBP', quote: 'JPY', symbol: 'GBP/JPY' },
  'NZD/USD': { base: 'NZD', quote: 'USD', symbol: 'NZD/USD' },
  'NZDUSD': { base: 'NZD', quote: 'USD', symbol: 'NZD/USD' },
  'EUR/CHF': { base: 'EUR', quote: 'CHF', symbol: 'EUR/CHF' },
  'EURCHF': { base: 'EUR', quote: 'CHF', symbol: 'EUR/CHF' },
  'AUD/JPY': { base: 'AUD', quote: 'JPY', symbol: 'AUD/JPY' },
  'AUDJPY': { base: 'AUD', quote: 'JPY', symbol: 'AUD/JPY' },
  'CAD/JPY': { base: 'CAD', quote: 'JPY', symbol: 'CAD/JPY' },
  'CADJPY': { base: 'CAD', quote: 'JPY', symbol: 'CAD/JPY' },
  'EUR/CAD': { base: 'EUR', quote: 'CAD', symbol: 'EUR/CAD' },
  'EURCAD': { base: 'EUR', quote: 'CAD', symbol: 'EUR/CAD' },
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function normalize(asset: string): string {
  // MISSION 2: STRICT OTC ROUTING
  if (asset.toUpperCase().includes("OTC") || asset.toLowerCase().includes("_otc")) {
    console.log(`[ExternalData] OTC detected for ${asset} — Routing to internal WebSocket only.`);
    throw new Error("OTC_ASSET_DETECTED"); 
  }
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
    // ACTION 2: COUPE-CIRCUIT OTC (LOG RENFORCÉ)
    if (asset.toUpperCase().includes('OTC')) {
      console.log(`[ExternalData] 🚀 BYPASS OTC : ${asset} détecté. Utilisation exclusive du WebSocket PO.`);
      return []; // Return empty to force fallback to Pocket Option WebSocket data
    }

    try {
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
    } catch (err) {
      if (err instanceof Error && err.message === "OTC_ASSET_DETECTED") {
        return []; // Silently fallback to WebSocket for OTC
      }
      throw err;
    }
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
        open: parseFloat(String(c[1])),
        high: parseFloat(String(c[2])),
        low: parseFloat(String(c[3])),
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
    const tfInfo = FOREX_MAP[pairKey] ?? FOREX_MAP[`${base}${quote}`];
    const symbol = tfInfo?.symbol ?? pairKey;

    // Try Twelve Data first (real OHLCV history) — cache 30s
    const hit = this.candleCache.get(cacheKey);
    if (hit && Date.now() - hit.fetchedAt < CANDLE_CACHE_MS) return hit.candles;

    const twelveCandles = await this.getTwelveDataCandles(symbol, tf, limit);
    if (twelveCandles.length >= 10) {
      this.candleCache.set(cacheKey, { candles: twelveCandles, fetchedAt: Date.now() });
      return twelveCandles;
    }

    // Fallback: refresh the current rate and build from ticks
    const lastFetch = this.forexFetchedAt.get(pairKey) ?? 0;
    if (Date.now() - lastFetch > FOREX_TICK_MS) {
      await this.refreshForexRate(base, quote, pairKey);
    }

    const ticks = this.forexTicks.get(pairKey) ?? [];
    if (ticks.length === 0) {
      // Return stale candles if any
      console.warn(`[ExternalData] No ticks for ${pairKey} — returning stale cache (${hit?.candles.length ?? 0} candles)`);
      return hit?.candles ?? [];
    }

    // Need at least 5 real ticks to build meaningful candles
    if (ticks.length < 5) {
      console.warn(`[ExternalData] Only ${ticks.length} tick(s) for ${pairKey} — insufficient for reliable signals. Bot will wait.`);
      return hit?.candles ?? [];
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

    // If we have very few buckets, return stale cache instead of generating fake data
    if (buckets.size < 5) {
      console.warn(`[ExternalData] Only ${buckets.size} tick bucket(s) — insufficient for candles. Waiting for more data.`);
      return [];
    }

    const candles: Candle[] = [];
    const sortedKeys = [...buckets.keys()].sort();
    for (const ts of sortedKeys) {
      const prices = buckets.get(ts)!;
      candles.push({
        timestamp: ts,
        open: prices[0],
        high: Math.max(...prices),
        low: Math.min(...prices),
        close: prices[prices.length - 1],
        volume: prices.length,
      });
    }

    return candles.slice(-limit);
  }

  /**
   * Fetch real OHLCV candles from Twelve Data using an API key.
   * Supports forex, crypto, stocks. Returns [] on failure.
   */
  private async getTwelveDataCandles(symbol: string, tf: Timeframe, limit: number): Promise<Candle[]> {
    // MISSION 1: API KEY VALIDATION
    if (!TWELVE_DATA_API_KEY) {
      console.error("[ExternalData] CRITICAL: TWELVE_DATA_API_KEY is missing in .env");
      return [];
    }

    const cacheKey = `twelvedata:${symbol}:${tf}`;
    const hit = this.candleCache.get(cacheKey);
    if (hit && Date.now() - hit.fetchedAt < CANDLE_CACHE_MS) return hit.candles;

    const interval = this.twelveDataInterval(tf);
    const url = `${TWELVE_DATA_BASE}/time_series?symbol=${encodeURIComponent(symbol)}&interval=${interval}&outputsize=${limit}&apikey=${TWELVE_DATA_API_KEY}&format=JSON`;

    try {
      console.log(`[ExternalData] Twelve Data → ${symbol} (${interval})`);
      const res = await fetchWithTimeout(url, 8000);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      if (data.status === 'error' || !Array.isArray(data.values)) {
        console.warn(`[ExternalData] Twelve Data error for ${symbol}: ${data.message ?? 'unknown'}`);
        return [];
      }

      const candles: Candle[] = (data.values as Record<string, string>[])
        .map(v => ({
          timestamp: Math.floor(new Date(v.datetime).getTime() / 1000),
          open: parseFloat(v.open),
          high: parseFloat(v.high),
          low: parseFloat(v.low),
          close: parseFloat(v.close),
          volume: parseFloat(v.volume ?? '0') || 0,
        }))
        .filter(c => c.timestamp > 0 && c.close > 0)
        .sort((a, b) => a.timestamp - b.timestamp);

      console.log(`[ExternalData] Twelve Data: ${candles.length} candles for ${symbol}`);
      this.candleCache.set(cacheKey, { candles, fetchedAt: Date.now() });
      return candles;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[ExternalData] Twelve Data failed (${symbol}): ${msg}`);
      return [];
    }
  }

  private twelveDataInterval(tf: Timeframe): string {
    const t = tf as string;
    if (t === '5s' || t === '10s' || t === '15s' || t === '30s') return '1min';
    if (t === '1m') return '1min';
    if (t === '3m') return '3min';
    if (t === '5m') return '5min';
    if (t === '15m') return '15min';
    if (t === '30m') return '30min';
    if (t === '1h') return '1h';
    return '1min';
  }

  /**
   * Last resort: synthesise candles by artificially splitting a price series.
   * ⚠️  DISABLED — we no longer generate fictional data.
   * Kept for reference only. Returns [] to force the bot to wait for real data.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private _synthesiseCandles_DISABLED(ticks: { price: number; ts: number }[], limit: number): Candle[] {
    console.warn('[ExternalData] synthesiseCandles called — DISABLED. Returning empty array.');
    return [];
  }
}

export const externalDataService = new ExternalDataService();
