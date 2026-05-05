import ccxt from 'ccxt';
import { Candle, Timeframe } from '../lib/trading';

const CACHE_MS = 30_000; // 30 second cache to avoid hammering Binance
const FETCH_TIMEOUT_MS = 8_000; // 8 second hard timeout per fetch

class ExternalDataService {
  private binance = new ccxt.binance({
    enableRateLimit: true,
    timeout: FETCH_TIMEOUT_MS,
  });

  // In-memory candle cache: key = "ASSET:TF", value = { candles, fetchedAt }
  private cache = new Map<string, { candles: Candle[]; fetchedAt: number }>();

  /**
   * Extended mapping: PocketOption asset names → Binance CCXT symbols
   */
  private mapSymbol(asset: string): string | null {
    const normalized = asset.toUpperCase().trim();
    const mapping: Record<string, string> = {
      'BTC/USD':   'BTC/USDT',
      'BTCUSD':    'BTC/USDT',
      'ETH/USD':   'ETH/USDT',
      'ETHUSD':    'ETH/USDT',
      'EUR/USD':   'EUR/USDT',
      'EURUSD':    'EUR/USDT',
      'GBP/USD':   'GBP/USDT',
      'GBPUSD':    'GBP/USDT',
      'AUD/USD':   'AUD/USDT',
      'AUDUSD':    'AUD/USDT',
      'USD/CAD':   'USDT/USDC',   // approximation — not always listed
      'USD/JPY':   'USDT/BIDR',   // rarely available; will silently fail
      'LTC/USD':   'LTC/USDT',
      'LTCUSD':    'LTC/USDT',
      'XRP/USD':   'XRP/USDT',
      'XRPUSD':    'XRP/USDT',
      'SOL/USD':   'SOL/USDT',
      'SOLUSD':    'SOL/USDT',
      'DOGE/USD':  'DOGE/USDT',
      'DOGEUSD':   'DOGE/USDT',
      'BNB/USD':   'BNB/USDT',
      'BNBUSD':    'BNB/USDT',
    };

    // Direct lookup
    if (mapping[normalized]) return mapping[normalized];

    // Try stripping spaces / slashes
    const stripped = normalized.replace(/[\s\/]/g, '');
    if (mapping[stripped]) return mapping[stripped];

    return null;
  }

  /**
   * Map timeframe string to Binance OHLCV interval
   */
  private mapTimeframe(tf: Timeframe): string {
    if (tf === '5s' || tf === '10s' || tf === '15s' || tf === '30s') return '1m';
    if (tf === '1m') return '1m';
    if (tf === '3m') return '3m';
    if (tf === '5m') return '5m';
    if (tf === '15m') return '15m';
    if (tf === '30m') return '30m';
    if (tf === '1h') return '1h';
    return '1m';
  }

  /**
   * Fetch candles with in-memory cache + timeout guard.
   * Returns empty array if asset is not supported or fetch fails.
   */
  async getExternalCandles(asset: string, tf: Timeframe, limit: number = 100): Promise<Candle[]> {
    const symbol = this.mapSymbol(asset);
    if (!symbol) {
      console.log(`[ExternalData] No Binance mapping for asset: ${asset}`);
      return [];
    }

    const cacheKey = `${symbol}:${tf}`;
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.fetchedAt < CACHE_MS) {
      return cached.candles;
    }

    try {
      const interval = this.mapTimeframe(tf);
      console.log(`[ExternalData] Fetching ${limit} candles for ${symbol} from Binance (${interval})...`);

      // Race fetch against a hard timeout
      const ohlcv = await Promise.race([
        this.binance.fetchOHLCV(symbol, interval, undefined, limit),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Binance fetch timeout')), FETCH_TIMEOUT_MS)
        ),
      ]);

      const candles: Candle[] = (ohlcv as (number | null)[][]).map((c) => ({
        timestamp: Math.floor((c[0] as number) / 1000),
        open:      c[1] as number,
        high:      c[2] as number,
        low:       c[3] as number,
        close:     c[4] as number,
        volume:    c[5] as number,
      }));

      this.cache.set(cacheKey, { candles, fetchedAt: Date.now() });
      console.log(`[ExternalData] Got ${candles.length} candles for ${symbol}.`);
      return candles;

    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[ExternalData] Binance fetch failed for ${symbol}: ${msg}`);
      // Return stale cache if available rather than nothing
      const stale = this.cache.get(cacheKey);
      if (stale && stale.candles.length > 0) {
        console.log(`[ExternalData] Returning stale cache (${stale.candles.length} candles) for ${symbol}`);
        return stale.candles;
      }
      return [];
    }
  }
}

export const externalDataService = new ExternalDataService();
