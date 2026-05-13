import { Candle, PriceActionState } from "../types";

export class PatternDetector {
  public static analyze(candles: Candle[]): PriceActionState {
    if (candles.length < 2) {
      return {
        isBullishPinbar: false, isBearishPinbar: false,
        isBullishEngulfing: false, isBearishEngulfing: false,
        isDoji: false
      };
    }

    const current = candles[candles.length - 1];
    const prev = candles[candles.length - 2];

    const body = Math.abs(current.close - current.open);
    const totalSize = current.high - current.low;
    const upperWick = current.high - Math.max(current.close, current.open);
    const lowerWick = Math.min(current.close, current.open) - current.low;

    // Pinbar detection (Wick is > 2x body, other wick is small)
    const isBullishPinbar = lowerWick > body * 2 && upperWick < body;
    const isBearishPinbar = upperWick > body * 2 && lowerWick < body;

    // Engulfing detection
    const isBullishEngulfing = current.close > current.open && prev.close < prev.open &&
                               current.close > prev.open && current.open < prev.close;
    const isBearishEngulfing = current.close < current.open && prev.close > prev.open &&
                               current.close < prev.open && current.open > prev.close;

    // Doji (Body is very small compared to total size)
    const isDoji = body <= totalSize * 0.1 && totalSize > 0;

    return {
      isBullishPinbar,
      isBearishPinbar,
      isBullishEngulfing,
      isBearishEngulfing,
      isDoji
    };
  }
}
