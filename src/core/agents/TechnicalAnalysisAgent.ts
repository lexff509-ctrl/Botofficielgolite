import { Candle, MarketState } from "./types";
import { MathIndicators } from "./indicators/MathIndicators";
import { PatternDetector } from "./priceAction/PatternDetector";
import { StructureAnalyzer } from "./marketStructure/StructureAnalyzer";

export class TechnicalAnalysisAgent {
  /**
   * Orchestrates sub-modules to generate a unified MarketState.
   * NO DECISION MAKING HERE. Pure analysis to feed the Confidence Agent.
   * Optimized for HFT and Micro-Timeframes.
   */
  public static analyze(candles: Candle[], asset: string, timeframe: string): MarketState {
    if (!candles || candles.length < 10) {
      throw new Error("TechnicalAnalysisAgent: Au moins 10 bougies sont nécessaires.");
    }

    const currentPrice = candles[candles.length - 1].close;
    const timestamp = candles[candles.length - 1].timestamp;

    // 1. Math Indicators (EMA, RSI, MACD, etc.)
    const indicators = MathIndicators.calculate(candles);

    // 2. Price Action Patterns (Pinbars, Engulfing, etc.)
    const priceAction = PatternDetector.analyze(candles);

    // 3. Market Structure & Trend (S/R, Trend Strength)
    const structure = StructureAnalyzer.analyze(candles, indicators);

    // Assemble the Brain's Topographical Map of the Market
    return {
      timestamp,
      asset,
      timeframe,
      currentPrice,
      indicators,
      priceAction,
      structure
    };
  }
}
