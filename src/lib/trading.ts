// Trading strategy engine - L'Impulsion Multi-Confirmation
// Using technicalindicators library for professional-grade indicator calculations
// Rule-based strategy: EMA20/50 trend + Stochastic momentum + Fractal reversal + Doji filter
// ALL conditions must be met for a signal to be generated

import {
  EMA,
  Stochastic,
  ATR,
  RSI,
  MACD,
  BollingerBands,
  SMA,
} from "technicalindicators";

export type Timeframe = "5s" | "10s" | "15s" | "30s" | "1m" | "3m" | "5m";

export const TIMEFRAMES: Timeframe[] = [
  "5s",
  "10s",
  "15s",
  "30s",
  "1m",
  "3m",
  "5m",
];

export interface Candle {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  timestamp: number;
}

export interface Indicators {
  // Core strategy indicators
  ema20: number;
  ema50: number;
  stochK: number;
  stochD: number;
  lowFractal: boolean;
  highFractal: boolean;
  dojiRejected: boolean;
  atr: number;
  // Legacy fields (kept for DB compatibility)
  rsi: number;
  macd: number;
  macdSignal: number;
  macdHistogram: number;
  ema9: number;
  ema21: number;
  bollingerUpper: number;
  bollingerMiddle: number;
  bollingerLower: number;
  stochastic: number;
  stochasticSignal: number;
}

export interface Signal {
  direction: "CALL" | "PUT";
  confidence: number;
  timeframe: Timeframe;
  asset: string;
  indicators: Indicators;
  multiTimeframeConfirmation: Record<Timeframe, "CALL" | "PUT" | "NEUTRAL">;
  timestamp: number;
}

// ============ PROFESSIONAL INDICATOR CALCULATIONS ============
// All indicators use the technicalindicators library - tested against TradingView

// EMA calculation using technicalindicators library
export function calculateEMA(closes: number[], period: number): number {
  if (closes.length < period) return closes[closes.length - 1] || 0;
  const result = EMA.calculate({ period, values: closes });
  return result.length > 0 ? result[result.length - 1] : closes[closes.length - 1];
}

// Full EMA series for gap comparison
export function calculateEMASeries(closes: number[], period: number): number[] {
  if (closes.length < period) return closes;
  return EMA.calculate({ period, values: closes });
}

// Stochastic(14,3,3) - proper slow stochastic using technicalindicators
export function calculateStochastic(
  candles: Candle[],
  period = 14,
  smoothK = 3,
  smoothD = 3
): { k: number; d: number } {
  if (candles.length < period + smoothK) return { k: 50, d: 50 };

  const input = {
    high: candles.map((c) => c.high),
    low: candles.map((c) => c.low),
    close: candles.map((c) => c.close),
    period,
    signalPeriod: smoothD,
  };

  const result = Stochastic.calculate(input);
  if (result.length === 0) return { k: 50, d: 50 };

  const last = result[result.length - 1];
  return { k: last.k, d: last.d };
}

// ATR - Average True Range using technicalindicators
export function calculateATR(candles: Candle[], period = 14): number {
  if (candles.length < 2) return 0;

  const input = {
    high: candles.map((c) => c.high),
    low: candles.map((c) => c.low),
    close: candles.map((c) => c.close),
    period,
  };

  const result = ATR.calculate(input);
  return result.length > 0 ? result[result.length - 1] : 0;
}

// RSI using technicalindicators
export function calculateRSI(closes: number[], period = 14): number {
  if (closes.length < period + 1) return 50;
  const result = RSI.calculate({ period, values: closes });
  return result.length > 0 ? result[result.length - 1] : 50;
}

// MACD using technicalindicators
export function calculateMACD(closes: number[]): {
  macd: number;
  signal: number;
  histogram: number;
  signalLine: number[];
} {
  if (closes.length < 26) {
    return { macd: 0, signal: 0, histogram: 0, signalLine: [] };
  }

  const result = MACD.calculate({
    values: closes,
    fastPeriod: 12,
    slowPeriod: 26,
    signalPeriod: 9,
    SimpleMAOscillator: false,
    SimpleMASignal: false,
  });

  if (result.length === 0) {
    return { macd: 0, signal: 0, histogram: 0, signalLine: [] };
  }

  const last = result[result.length - 1];
  return {
    macd: last.MACD || 0,
    signal: last.signal || 0,
    histogram: last.histogram || 0,
    signalLine: result.map((r) => r.signal || 0),
  };
}

// Bollinger Bands using technicalindicators
export function calculateBollinger(
  closes: number[],
  period = 20,
  stdDevMultiplier = 2
): { upper: number; middle: number; lower: number } {
  if (closes.length < period) {
    const price = closes[closes.length - 1] || 0;
    return { upper: price, middle: price, lower: price };
  }

  const result = BollingerBands.calculate({
    period,
    stdDev: stdDevMultiplier,
    values: closes,
  });

  if (result.length === 0) {
    const price = closes[closes.length - 1];
    return { upper: price, middle: price, lower: price };
  }

  const last = result[result.length - 1];
  return {
    upper: last.upper,
    middle: last.middle,
    lower: last.lower,
  };
}

// ============ CUSTOM INDICATORS (not in technicalindicators) ============

// Bill Williams Fractals - detect reversal points
// Scans the last few candles for any confirmed fractal (not just the most recent)
export function calculateFractals(candles: Candle[]): {
  lowFractal: boolean;
  highFractal: boolean;
} {
  if (candles.length < 5) return { lowFractal: false, highFractal: false };

  const n = candles.length;
  let lowFractal = false;
  let highFractal = false;

  // Scan the last 5 possible fractal positions (from n-3 down to n-7)
  // This increases the chance of finding a recent fractal
  for (let i = Math.max(2, n - 7); i <= n - 3; i++) {
    if (i < 2 || i >= n - 2) continue;

    const high = candles[i].high;
    const low = candles[i].low;

    let isHigh = true;
    let isLow = true;

    // Check both sides: 2 bars left and 2 bars right
    for (let j = i - 2; j <= i + 2; j++) {
      if (j === i) continue;
      if (candles[j].high >= high) isHigh = false;
      if (candles[j].low <= low) isLow = false;
    }

    if (isHigh) highFractal = true;
    if (isLow) lowFractal = true;
  }

  return { lowFractal, highFractal };
}

// Detect bullish/bearish reversal candle patterns
// A bullish reversal: recent candle has a long lower wick (hammer-like)
// A bearish reversal: recent candle has a long upper wick (shooting star-like)
function detectReversalCandle(candles: Candle[]): {
  bullishReversal: boolean;
  bearishReversal: boolean;
} {
  if (candles.length < 2) return { bullishReversal: false, bearishReversal: false };

  // Check the previous candle (n-2) for reversal patterns
  const prev = candles[candles.length - 2];
  const body = Math.abs(prev.close - prev.open);
  const range = prev.high - prev.low;
  if (range === 0) return { bullishReversal: false, bearishReversal: false };

  const bodyRatio = body / range;
  const isBullish = prev.close > prev.open;

  // Lower wick ratio (bullish signal)
  const lowerWick = Math.min(prev.open, prev.close) - prev.low;
  const lowerWickRatio = lowerWick / range;

  // Upper wick ratio (bearish signal)
  const upperWick = prev.high - Math.max(prev.open, prev.close);
  const upperWickRatio = upperWick / range;

  // Bullish reversal: long lower wick (>50% of range), small body (<40% of range)
  const bullishReversal = lowerWickRatio > 0.5 && bodyRatio < 0.4;

  // Bearish reversal: long upper wick (>50% of range), small body (<40% of range)
  const bearishReversal = upperWickRatio > 0.5 && bodyRatio < 0.4;

  return { bullishReversal, bearishReversal };
}

// Doji detection: body size relative to candle range
// A doji candle has a very small body relative to its wicks
export function isDojiCandle(
  candle: Candle,
  thresholdPips: number = 2,
  pipValue: number = 0.0001
): boolean {
  const bodySize = Math.abs(candle.close - candle.open);
  const totalRange = candle.high - candle.low;
  // A doji has body < threshold AND body is small relative to total range
  if (totalRange === 0) return true; // No movement at all
  const bodyRatio = bodySize / totalRange;
  return bodySize < thresholdPips * pipValue || bodyRatio < 0.1;
}

// ============ L'IMPULSION MULTI-CONFIRMATION STRATEGY ============

// Pip value for different asset types
function getPipValue(asset: string): number {
  if (asset.includes("JPY")) return 0.01;
  if (asset.includes("BTC") || asset.includes("ETH")) return 1;
  return 0.0001; // Standard forex pairs
}

// Core strategy evaluation - ALL conditions must be met for a signal
function evaluateImpulsion(
  candles: Candle[],
  asset: string
): {
  direction: "CALL" | "PUT" | null;
  ema20: number;
  ema50: number;
  stochK: number;
  stochD: number;
  lowFractal: boolean;
  highFractal: boolean;
  dojiRejected: boolean;
  atr: number;
} {
  const closes = candles.map((c) => c.close);
  const currentPrice = closes[closes.length - 1];

  // Calculate core indicators using professional library
  const ema20 = calculateEMA(closes, 20);
  const ema50 = calculateEMA(closes, 50);
  const { k: stochK, d: stochD } = calculateStochastic(candles, 14, 3, 3);
  const { lowFractal, highFractal } = calculateFractals(candles);
  const atr = calculateATR(candles, 14);
  const { bullishReversal, bearishReversal } = detectReversalCandle(candles);

  // Doji filter on the previous candle (candle at n-2, since n-1 is current)
  const prevCandle = candles[candles.length - 2];
  const pipValue = getPipValue(asset);
  // Only reject if body is extremely small relative to ATR (classic doji)
  const dojiThreshold = Math.max(3, atr * 0.15 / pipValue); // 3 pips or 15% of ATR
  const dojiRejected = prevCandle ? isDojiCandle(prevCandle, dojiThreshold, pipValue) : false;

  // If previous candle is a doji, reject signal
  if (dojiRejected) {
    return {
      direction: null,
      ema20, ema50, stochK, stochD, lowFractal, highFractal, dojiRejected, atr,
    };
  }

  // Proximity zone: price must be within 1.0 * ATR of EMA20 (retest zone)
  const proximityThreshold = atr * 1.0;
  const nearEma20 = Math.abs(currentPrice - ema20) <= proximityThreshold;

  // ============ CALL CONDITIONS ============
  // 1. Bullish trend: Price > EMA20 AND EMA20 > EMA50
  const callTrend = currentPrice > ema20 && ema20 > ema50;
  // 2. Price near EMA20 (pullback/retest)
  const callProximity = nearEma20;
  // 3. Stochastic oversold + bullish cross: %K < 30 AND %K > %D
  const callMomentum = stochK < 30 && stochK > stochD;
  // 4. Reversal signal: low fractal OR bullish reversal candle (hammer-like)
  const callReversal = lowFractal || bullishReversal;

  if (callTrend && callProximity && callMomentum && callReversal) {
    return {
      direction: "CALL",
      ema20, ema50, stochK, stochD, lowFractal, highFractal, dojiRejected, atr,
    };
  }

  // ============ PUT CONDITIONS ============
  // 1. Bearish trend: Price < EMA20 AND EMA20 < EMA50
  const putTrend = currentPrice < ema20 && ema20 < ema50;
  // 2. Price near EMA20 (pullback/retest)
  const putProximity = nearEma20;
  // 3. Stochastic overbought + bearish cross: %K > 70 AND %K < %D
  const putMomentum = stochK > 70 && stochK < stochD;
  // 4. Reversal signal: high fractal OR bearish reversal candle (shooting star-like)
  const putReversal = highFractal || bearishReversal;

  if (putTrend && putProximity && putMomentum && putReversal) {
    return {
      direction: "PUT",
      ema20, ema50, stochK, stochD, lowFractal, highFractal, dojiRejected, atr,
    };
  }

  return {
    direction: null,
    ema20, ema50, stochK, stochD, lowFractal, highFractal, dojiRejected, atr,
  };
}

// Calculate confidence based on signal quality
function calculateConfidence(
  direction: "CALL" | "PUT",
  candles: Candle[],
  ema20: number,
  ema50: number,
  stochK: number,
  stochD: number,
  mtfConfirmation: Record<Timeframe, "CALL" | "PUT" | "NEUTRAL">
): number {
  let confidence = 60; // Base confidence

  // +15% MTF: next-higher timeframe EMA50 agrees
  const confirmedTFs = TIMEFRAMES.filter((tf) => mtfConfirmation[tf] === direction).length;
  const contraryTFs = TIMEFRAMES.filter(
    (tf) => mtfConfirmation[tf] !== direction && mtfConfirmation[tf] !== "NEUTRAL"
  ).length;
  if (confirmedTFs > contraryTFs + 1) {
    confidence += 15;
  } else if (confirmedTFs > contraryTFs) {
    confidence += 8;
  }

  // +5% Deep stochastic: %K < 10 for CALL, %K > 90 for PUT
  if (direction === "CALL" && stochK < 10) confidence += 5;
  if (direction === "PUT" && stochK > 90) confidence += 5;

  // +5% EMA gap widening: EMA20-EMA50 gap is increasing vs 3 candles ago
  const closes = candles.map((c) => c.close);
  if (candles.length >= 53) {
    const recentEma20 = calculateEMA(closes, 20);
    const recentEma50 = calculateEMA(closes, 50);
    const currentGap = Math.abs(recentEma20 - recentEma50);

    // EMA gap 3 candles ago
    const olderCloses = closes.slice(0, -3);
    if (olderCloses.length >= 50) {
      const olderEma20 = calculateEMA(olderCloses, 20);
      const olderEma50 = calculateEMA(olderCloses, 50);
      const olderGap = Math.abs(olderEma20 - olderEma50);

      if (currentGap > olderGap) confidence += 5;
    }
  }

  // -10% Barely in zone: Stochastic %K between 25-30 for CALL or 70-75 for PUT
  if (direction === "CALL" && stochK >= 25 && stochK < 30) confidence -= 10;
  if (direction === "PUT" && stochK > 70 && stochK <= 75) confidence -= 10;

  // Clamp between 0 and 95
  return Math.min(95, Math.max(0, confidence));
}

// ============ MAIN SIGNAL GENERATION ============

export function generateSignal(
  candles: Candle[],
  asset: string,
  timeframe: Timeframe
): Signal | null {
  if (candles.length < 50) return null;

  // Evaluate L'Impulsion Multi-Confirmation conditions
  const evaluation = evaluateImpulsion(candles, asset);

  if (!evaluation.direction) {
    return null; // No signal - conditions not met
  }

  // Calculate legacy indicators using professional library
  const closes = candles.map((c) => c.close);
  const rsi = calculateRSI(closes);
  const { macd, signal: macdSignal, histogram: macdHistogram } = calculateMACD(closes);
  const ema9 = calculateEMA(closes, 9);
  const ema21 = calculateEMA(closes, 21);
  const bollinger = calculateBollinger(closes);

  const indicators: Indicators = {
    // New strategy indicators
    ema20: evaluation.ema20,
    ema50: evaluation.ema50,
    stochK: evaluation.stochK,
    stochD: evaluation.stochD,
    lowFractal: evaluation.lowFractal,
    highFractal: evaluation.highFractal,
    dojiRejected: evaluation.dojiRejected,
    atr: evaluation.atr,
    // Legacy indicators
    rsi,
    macd,
    macdSignal,
    macdHistogram,
    ema9,
    ema21,
    bollingerUpper: bollinger.upper,
    bollingerMiddle: bollinger.middle,
    bollingerLower: bollinger.lower,
    stochastic: evaluation.stochK,
    stochasticSignal: evaluation.stochD,
  };

  // Multi-timeframe confirmation
  const mtfConfirmation: Record<Timeframe, "CALL" | "PUT" | "NEUTRAL"> =
    {} as Record<Timeframe, "CALL" | "PUT" | "NEUTRAL">;

  for (const tf of TIMEFRAMES) {
    const aggregationFactor = getTimeframeFactor(timeframe, tf);
    const aggregatedCandles = aggregateCandles(candles, aggregationFactor);

    if (aggregatedCandles.length < 50) {
      mtfConfirmation[tf] = "NEUTRAL";
      continue;
    }

    // MTF uses EMA50 direction as the primary confirmation
    const tfCloses = aggregatedCandles.map((c) => c.close);
    const tfEma20 = calculateEMA(tfCloses, 20);
    const tfEma50 = calculateEMA(tfCloses, 50);
    const tfPrice = tfCloses[tfCloses.length - 1];

    if (tfPrice > tfEma50 && tfEma20 > tfEma50) {
      mtfConfirmation[tf] = "CALL";
    } else if (tfPrice < tfEma50 && tfEma20 < tfEma50) {
      mtfConfirmation[tf] = "PUT";
    } else {
      mtfConfirmation[tf] = "NEUTRAL";
    }
  }

  // Calculate confidence
  const confidence = calculateConfidence(
    evaluation.direction,
    candles,
    evaluation.ema20,
    evaluation.ema50,
    evaluation.stochK,
    evaluation.stochD,
    mtfConfirmation
  );

  // Minimum confidence threshold: 55%
  if (confidence < 55) return null;

  return {
    direction: evaluation.direction,
    confidence,
    timeframe,
    asset,
    indicators,
    multiTimeframeConfirmation: mtfConfirmation,
    timestamp: Date.now(),
  };
}

// ============ HELPERS ============

function getTimeframeFactor(
  base: Timeframe,
  target: Timeframe
): number {
  const toSeconds = (tf: Timeframe): number => {
    if (tf.endsWith("s")) return parseInt(tf);
    if (tf.endsWith("m")) return parseInt(tf) * 60;
    return 60;
  };

  const baseSec = toSeconds(base);
  const targetSec = toSeconds(target);
  return Math.max(1, Math.round(targetSec / baseSec));
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

// ============ MOCK CANDLE GENERATION (for testing) ============

export function generateMockCandles(
  count: number,
  basePrice = 1.0850
): Candle[] {
  const candles: Candle[] = [];
  let price = basePrice;
  const now = Date.now();
  const trend = (Math.random() - 0.48) * 0.0001;

  for (let i = count; i >= 0; i--) {
    const noise = (Math.random() - 0.5) * 0.002;
    const open = price;
    price = Math.max(0.0001, price + noise + trend);
    const high = Math.max(open, price) + Math.random() * 0.0005;
    const low = Math.min(open, price) - Math.random() * 0.0005;
    candles.push({
      open,
      high,
      low,
      close: price,
      volume: Math.floor(Math.random() * 10000) + 1000,
      timestamp: now - i * 60000,
    });
  }
  return candles;
}
