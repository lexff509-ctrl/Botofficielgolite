import { EMA, RSI, MACD, Stochastic, BollingerBands, VWAP } from "technicalindicators";
import { Candle, IndicatorsState } from "../types";

export class MathIndicators {
  public static calculate(candles: Candle[]): IndicatorsState {
    const closes = candles.map(c => c.close);
    const highs = candles.map(c => c.high);
    const lows = candles.map(c => c.low);
    // Prevent VWAP failure when volume is exactly 0
    const volumes = candles.map(c => c.volume === 0 ? 1 : c.volume);
    const currentPrice = closes[closes.length - 1];

    const getS = (res: any[]) => res.length > 0 ? res[res.length - 1] : null;

    const ema9 = getS(EMA.calculate({ period: 9, values: closes })) || currentPrice;
    const ema21 = getS(EMA.calculate({ period: 21, values: closes })) || currentPrice;
    const ema50 = getS(EMA.calculate({ period: 50, values: closes })) || currentPrice;
    const rsi = getS(RSI.calculate({ period: 14, values: closes })) || 50;
    
    const rawMacd = getS(MACD.calculate({ 
      fastPeriod: 12, slowPeriod: 26, signalPeriod: 9, 
      values: closes, SimpleMAOscillator: false, SimpleMASignal: false 
    }));
    const macdData = rawMacd ? { MACD: rawMacd.MACD || 0, signal: rawMacd.signal || 0, histogram: rawMacd.histogram || 0 } : { MACD: 0, signal: 0, histogram: 0 };
    
    const stochData = getS(Stochastic.calculate({ 
      high: highs, low: lows, close: closes, period: 14, signalPeriod: 3 
    })) || { k: 50, d: 50 };
    
    const bbResult = getS(BollingerBands.calculate({ 
      period: 20, stdDev: 2, values: closes 
    })) || { upper: currentPrice, middle: currentPrice, lower: currentPrice };
    
    const bbWidth = bbResult.middle === 0 ? 0 : (bbResult.upper - bbResult.lower) / bbResult.middle;

    const vwap = getS(VWAP.calculate({ 
      high: highs, low: lows, close: closes, volume: volumes 
    })) || currentPrice;

    return {
      ema9,
      ema21,
      ema50,
      rsi,
      macd: macdData,
      stochastic: stochData,
      bollinger: { ...bbResult, width: bbWidth },
      vwap
    };
  }
}
