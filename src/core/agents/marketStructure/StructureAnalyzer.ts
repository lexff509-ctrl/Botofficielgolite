import { Candle, IndicatorsState, MarketStructureState } from "../types";

export class StructureAnalyzer {
  public static analyze(candles: Candle[], ind: IndicatorsState): MarketStructureState {
    const currentPrice = candles[candles.length - 1].close;

    // Extract recent highs and lows for simple S/R (Last 30 candles)
    const lookback = candles.slice(-30);
    const highs = lookback.map(c => c.high);
    const lows = lookback.map(c => c.low);
    
    let support = Math.min(...lows);
    let resistance = Math.max(...highs);
    if (support === Infinity) support = currentPrice;
    if (resistance === -Infinity) resistance = currentPrice;

    // Proximity logic
    const range = resistance - support;
    const isNearSupport = range > 0 && currentPrice <= support + (range * 0.1);
    const isNearResistance = range > 0 && currentPrice >= resistance - (range * 0.1);

    // Trend logic
    let trend: "BULLISH" | "BEARISH" | "RANGE" = "RANGE";
    let trendStrength = 0;

    if (currentPrice > ind.ema21 && ind.ema9 > ind.ema21) {
      trend = "BULLISH";
      trendStrength = 50 + (currentPrice > ind.ema50 ? 25 : 0) + ((ind.macd.histogram || 0) > 0 ? 25 : 0);
    } else if (currentPrice < ind.ema21 && ind.ema9 < ind.ema21) {
      trend = "BEARISH";
      trendStrength = 50 + (currentPrice < ind.ema50 ? 25 : 0) + ((ind.macd.histogram || 0) < 0 ? 25 : 0);
    } else {
      trend = "RANGE";
      trendStrength = 20; // Weak direction
    }

    // Volatility logic (Using BB width proxy)
    let volatility: "HIGH" | "NORMAL" | "LOW" = "NORMAL";
    if (ind.bollinger.width > 0.005) volatility = "HIGH";
    else if (ind.bollinger.width < 0.001) volatility = "LOW";

    return {
      support,
      resistance,
      isNearSupport,
      isNearResistance,
      trend,
      trendStrength,
      volatility
    };
  }
}
