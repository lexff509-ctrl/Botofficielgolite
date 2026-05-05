import ccxt from 'ccxt';
import { Candle, Timeframe } from '../lib/trading';

class ExternalDataService {
  private binance = new ccxt.binance({
    enableRateLimit: true,
  });

  private lastFetchTime = new Map<string, number>();
  private CACHE_MS = 5000; // 5 seconds cache for external data

  /**
   * Map PocketOption asset names to CCXT/Binance symbols
   */
  private mapSymbol(asset: string): string | null {
    const mapping: Record<string, string> = {
      'BTC/USD': 'BTC/USDT',
      'ETH/USD': 'ETH/USDT',
      'EUR/USD': 'EUR/USDT',
      'GBP/USD': 'GBP/USDT',
      'USD/JPY': 'USD/JPY', // Note: Binance may not have all FX pairs, might need another exchange
    };
    return mapping[asset] || null;
  }

  /**
   * Map timeframe to CCXT format
   */
  private mapTimeframe(tf: Timeframe): string {
    if (tf === '1m') return '1m';
    if (tf === '3m') return '3m';
    if (tf === '5m') return '5m';
    // For smaller timeframes, we'll try to get 1m and simulate or use 1m as base
    return '1m';
  }

  async getExternalCandles(asset: string, tf: Timeframe, limit: number = 100): Promise<Candle[]> {
    const symbol = this.mapSymbol(asset);
    if (!symbol) return [];

    try {
      const timeframe = this.mapTimeframe(tf);
      console.log(`[ExternalData] Fetching ${limit} candles for ${symbol} from Binance (${timeframe})...`);
      
      const ohlcv = await this.binance.fetchOHLCV(symbol, timeframe, undefined, limit);
      
      return ohlcv.map(c => ({
        timestamp: Math.floor((c[0] as number) / 1000),
        open: c[1] as number,
        high: c[2] as number,
        low: c[3] as number,
        close: c[4] as number,
        volume: c[5] as number,
      }));
    } catch (err) {
      console.error(`[ExternalData] Error fetching from Binance:`, err);
      return [];
    }
  }
}

export const externalDataService = new ExternalDataService();
