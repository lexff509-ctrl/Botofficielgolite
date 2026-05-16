/**
 * MTFAnalysisAgent — Multi-TimeFrame Analysis
 * Builds higher-TF candles from existing tick data and checks trend alignment.
 * 
 * Architecture:
 *   LTF (entry TF)   → Entry signal origin
 *   HTF1 (1 step up) → Trend confirmation
 *   HTF2 (2 steps)   → Macro trend filter
 * 
 * Logic: Signal is CONFIRMED only when HTF trend aligns with LTF signal.
 */

import { Candle } from "./types";
import { calculateEMA, calculateRSI } from "@/lib/trading";

export type TrendBias = "BULLISH" | "BEARISH" | "NEUTRAL";

export interface MTFResult {
  htf1Trend: TrendBias;       // 1 step up (e.g., 1m → 5m)
  htf2Trend: TrendBias;       // 2 steps up (e.g., 1m → 15m)
  alignmentScore: number;     // -100 to +100 (positive = bullish aligned)
  confirmation: "STRONG" | "MODERATE" | "WEAK" | "CONFLICT";
  reason: string;
}

// Timeframe hierarchy (in seconds)
const TF_SECONDS: Record<string, number> = {
  "5s": 5, "10s": 10, "15s": 15, "30s": 30,
  "1m": 60, "3m": 180, "5m": 300
};

const TF_ORDER = ["5s", "10s", "15s", "30s", "1m", "3m", "5m"];

/**
 * Aggregate LTF candles into HTF candles
 */
function aggregateCandles(candles: Candle[], ltfSeconds: number, htfSeconds: number): Candle[] {
  const ratio = Math.floor(htfSeconds / ltfSeconds);
  if (ratio < 2 || candles.length < ratio) return [];

  const result: Candle[] = [];
  for (let i = 0; i + ratio <= candles.length; i += ratio) {
    const chunk = candles.slice(i, i + ratio);
    result.push({
      open: chunk[0].open,
      high: Math.max(...chunk.map(c => c.high)),
      low: Math.min(...chunk.map(c => c.low)),
      close: chunk[chunk.length - 1].close,
      volume: chunk.reduce((s, c) => s + (c.volume || 0), 0),
      timestamp: chunk[chunk.length - 1].timestamp,
    });
  }
  return result;
}

/**
 * Evaluate trend from candles using EMA crossover + RSI
 */
function evalTrend(candles: Candle[]): { bias: TrendBias; strength: number } {
  if (candles.length < 5) return { bias: "NEUTRAL", strength: 0 };

  const closes = candles.map(c => c.close);
  const n = closes.length;

  const ema9  = calculateEMA(closes, Math.min(9, n));
  const ema21 = calculateEMA(closes, Math.min(21, n));
  const rsi   = n >= 14 ? calculateRSI(closes, 14) : 50;

  // Price vs EMA trend
  const price = closes[n - 1];
  const prevPrice = closes[n - 2] ?? price;
  const momentum = price > prevPrice ? 1 : -1;

  let score = 0;
  if (ema9 > ema21) score += 40;     else score -= 40;
  if (price > ema9) score += 20;     else score -= 20;
  if (rsi > 55)     score += 20;
  else if (rsi < 45) score -= 20;
  score += momentum * 10;

  // Higher-high / higher-low (last 5 candles)
  if (n >= 5) {
    const highs = candles.slice(-5).map(c => c.high);
    const lows  = candles.slice(-5).map(c => c.low);
    const hhCheck = highs[4] > highs[2] && highs[2] > highs[0];
    const llCheck = lows[4]  < lows[2]  && lows[2]  < lows[0];
    const hlCheck = lows[4]  > lows[2]  && lows[2]  > lows[0];
    if (hhCheck && hlCheck) score += 20;   // Uptrend structure
    if (llCheck) score -= 20;              // Downtrend structure
  }

  score = Math.max(-100, Math.min(100, score));
  const bias: TrendBias = score >= 20 ? "BULLISH" : score <= -20 ? "BEARISH" : "NEUTRAL";
  return { bias, strength: Math.abs(score) };
}

export class MTFAnalysisAgent {
  /**
   * Analyzes trend alignment across multiple timeframes.
   * @param candles    LTF candles (entry timeframe)
   * @param timeframe  LTF timeframe string (e.g., "1m")
   */
  public static analyze(candles: Candle[], timeframe: string): MTFResult {
    const DEFAULT_NEUTRAL_RESULT: MTFResult = {
      htf1Trend: "NEUTRAL",
      htf2Trend: "NEUTRAL",
      alignmentScore: 0,
      confirmation: "CONFLICT",
      reason: "MTF circuit breaker (fallback)"
    };

    try {
      return this._doAnalysis(candles, timeframe);
    } catch (err) {
      console.warn("[MTFAnalysisAgent] Error during analysis, using fallback:", (err as Error).message);
      return DEFAULT_NEUTRAL_RESULT;
    }
  }

  private static _doAnalysis(candles: Candle[], timeframe: string): MTFResult {
    const ltfIdx  = TF_ORDER.indexOf(timeframe);
    const ltfSec  = TF_SECONDS[timeframe] ?? 60;

    // Build HTF1 (1 step above)
    const htf1Idx = Math.min(ltfIdx + 2, TF_ORDER.length - 1);
    const htf1Key = TF_ORDER[htf1Idx];
    const htf1Sec = TF_SECONDS[htf1Key];
    const htf1Candles = aggregateCandles(candles, ltfSec, htf1Sec);

    // Build HTF2 (2 steps above)
    const htf2Idx = Math.min(ltfIdx + 3, TF_ORDER.length - 1);
    const htf2Key = TF_ORDER[htf2Idx];
    const htf2Sec = TF_SECONDS[htf2Key];
    const htf2Candles = aggregateCandles(candles, ltfSec, htf2Sec);

    const htf1 = evalTrend(htf1Candles);
    const htf2 = evalTrend(htf2Candles);

    // Alignment score: weighted average of HTF biases
    const toScore = (b: TrendBias, s: number) =>
      b === "BULLISH" ? s : b === "BEARISH" ? -s : 0;

    const alignmentScore = Math.round(
      toScore(htf1.bias, htf1.strength) * 0.6 +
      toScore(htf2.bias, htf2.strength) * 0.4
    );

    // Confirmation level
    let confirmation: MTFResult["confirmation"] = "WEAK";
    const bothBull = htf1.bias === "BULLISH" && htf2.bias === "BULLISH";
    const bothBear = htf1.bias === "BEARISH" && htf2.bias === "BEARISH";
    const conflict = (htf1.bias === "BULLISH" && htf2.bias === "BEARISH") ||
                     (htf1.bias === "BEARISH" && htf2.bias === "BULLISH");

    if (bothBull || bothBear) confirmation = "STRONG";
    else if (conflict) confirmation = "CONFLICT";
    else if (htf1.bias !== "NEUTRAL") confirmation = "MODERATE";

    const reason = [
      `[MTF] ${htf1Key}: ${htf1.bias} (${htf1.strength}pts)`,
      `${htf2Key}: ${htf2.bias} (${htf2.strength}pts)`,
      `Alignement: ${alignmentScore > 0 ? "+" : ""}${alignmentScore} → ${confirmation}`
    ].join(" | ");

    return { htf1Trend: htf1.bias, htf2Trend: htf2.bias, alignmentScore, confirmation, reason };
  }
}
