// Trading strategy engine - L'Impulsion Multi-Confirmation
// Rule-based strategy: EMA20/50 trend + Stochastic momentum + Fractal reversal + Doji filter
// ALL conditions must be met for a signal to be generated

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

// ============ INDICATOR CALCULATIONS ============

// EMA calculation using standard SMA seed + exponential smoothing
export function calculateEMA(closes: number[], period: number): number {
  if (closes.length < period) return closes[closes.length - 1];
  const k = 2 / (period + 1);
  let ema = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < closes.length; i++) {
    ema = closes[i] * k + ema * (1 - k);
  }
  return ema;
}

// Full EMA series for gap comparison
export function calculateEMASeries(closes: number[], period: number): number[] {
  if (closes.length === 0) return [];
  const k = 2 / (period + 1);
  const result: number[] = [];
  let ema = closes[0];
  result.push(ema);
  for (let i = 1; i < closes.length; i++) {
    ema = closes[i] * k + ema * (1 - k);
    result.push(ema);
  }
  return result;
}

// Stochastic(14,3,3) - proper slow stochastic with %K smoothed and %D
export function calculateStochastic(
  candles: Candle[],
  period = 14,
  smoothK = 3,
  smoothD = 3
): { k: number; d: number } {
  if (candles.length < period + smoothK) return { k: 50, d: 50 };

  // Compute raw %K values for the last (smoothK + smoothD - 1) periods
  const rawKValues: number[] = [];
  const startIdx = Math.max(period - 1, candles.length - smoothK - smoothD + 1);

  for (let idx = startIdx; idx < candles.length; idx++) {
    const sliceStart = Math.max(0, idx - period + 1);
    const slice = candles.slice(sliceStart, idx + 1);
    const lowest = Math.min(...slice.map((c) => c.low));
    const highest = Math.max(...slice.map((c) => c.high));
    const close = candles[idx].close;
    rawKValues.push(
      highest === lowest ? 50 : ((close - lowest) / (highest - lowest)) * 100
    );
  }

  if (rawKValues.length < smoothK) return { k: 50, d: 50 };

  // Smoothed %K = SMA of raw %K over smoothK periods
  const smoothedK: number[] = [];
  for (let i = smoothK - 1; i < rawKValues.length; i++) {
    const sum = rawKValues.slice(i - smoothK + 1, i + 1).reduce((a, b) => a + b, 0);
    smoothedK.push(sum / smoothK);
  }

  // %K = last smoothed value
  const k = smoothedK[smoothedK.length - 1];

  // %D = SMA of smoothed %K over smoothD periods
  if (smoothedK.length < smoothD) return { k, d: k };
  const d = smoothedK.slice(-smoothD).reduce((a, b) => a + b, 0) / smoothD;

  return { k, d };
}

// ATR - Average True Range
export function calculateATR(candles: Candle[], period = 14): number {
  if (candles.length < 2) return 0;
  const trueRanges: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];
    const prev = candles[i - 1];
    trueRanges.push(
      Math.max(
        c.high - c.low,
        Math.abs(c.high - prev.close),
        Math.abs(c.low - prev.close)
      )
    );
  }
  const slice = trueRanges.slice(-period);
  if (slice.length === 0) return 0;
  let atr = slice[0];
  const k = 2 / (period + 1);
  for (let i = 1; i < slice.length; i++) {
    atr = slice[i] * k + atr * (1 - k);
  }
  return atr;
}

// Bill Williams Fractals - detect reversal points
// High fractal at index i: high[i] > high[i-1] AND high[i] > high[i-2] AND high[i] > high[i+1] AND high[i] > high[i+2]
// Low fractal at index i: low[i] < low[i-1] AND low[i] < low[i-2] AND low[i] < low[i+1] AND low[i] < low[i+2]
export function calculateFractals(candles: Candle[]): {
  lowFractal: boolean;
  highFractal: boolean;
} {
  // We check if the candle at index (n-2) is a fractal
  // We need at least 5 candles, and we check the 3rd from the end
  if (candles.length < 5) return { lowFractal: false, highFractal: false };

  const n = candles.length;
  // Check the candle at index n-2 (one candle back from current)
  // This is the "previous completed candle" relative to the current price
  const i = n - 2;
  if (i < 2 || i >= n - 1) return { lowFractal: false, highFractal: false };

  const high = candles[i].high;
  const low = candles[i].low;

  // High fractal: center candle's high is higher than 2 bars on each side
  let highFractal = true;
  let lowFractal = true;

  // Check left side (i-2, i-1) and right side (i+1)
  // For the right side, we only have i+1 (the current/latest candle)
  for (let j = Math.max(0, i - 2); j < i; j++) {
    if (candles[j].high >= high) highFractal = false;
    if (candles[j].low <= low) lowFractal = false;
  }
  // Right side: check i+1 if it exists
  if (i + 1 < n) {
    if (candles[i + 1].high >= high) highFractal = false;
    if (candles[i + 1].low <= low) lowFractal = false;
  }

  return { lowFractal, highFractal };
}

// Doji detection: body size less than threshold in pips
// A doji candle has a very small body relative to its wicks
// For forex: 2 pips = 0.0002; for crypto we use ATR-relative threshold
export function isDojiCandle(
  candle: Candle,
  thresholdPips: number = 2,
  pipValue: number = 0.0001
): boolean {
  const bodySize = Math.abs(candle.close - candle.open);
  return bodySize < thresholdPips * pipValue;
}

// RSI - kept for legacy/DB compatibility
export function calculateRSI(closes: number[], period = 14): number {
  if (closes.length < period + 1) return 50;
  let gains = 0;
  let losses = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) gains += diff;
    else losses -= diff;
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

// MACD - kept for legacy/DB compatibility
export function calculateMACD(closes: number[]): {
  macd: number;
  signal: number;
  histogram: number;
  signalLine: number[];
} {
  if (closes.length < 26) {
    return { macd: 0, signal: 0, histogram: 0, signalLine: [] };
  }
  const ema12Series = calculateEMASeries(closes, 12);
  const ema26Series = calculateEMASeries(closes, 26);
  const macdLine: number[] = [];
  for (let i = 0; i < closes.length; i++) {
    macdLine.push(ema12Series[i] - ema26Series[i]);
  }
  const signalLine = calculateEMASeries(macdLine, 9);
  const lastMacd = macdLine[macdLine.length - 1];
  const lastSignal = signalLine[signalLine.length - 1];
  const histogram = lastMacd - lastSignal;
  return { macd: lastMacd, signal: lastSignal, histogram, signalLine };
}

// Bollinger Bands - kept for legacy/DB compatibility
export function calculateBollinger(
  closes: number[],
  period = 20,
  stdDevMultiplier = 2
): { upper: number; middle: number; lower: number } {
  const slice = closes.slice(-period);
  const middle = slice.reduce((a, b) => a + b, 0) / slice.length;
  const variance =
    slice.reduce((acc, val) => acc + Math.pow(val - middle, 2), 0) /
    slice.length;
  const stdDev = Math.sqrt(variance);
  return {
    upper: middle + stdDevMultiplier * stdDev,
    middle,
    lower: middle - stdDevMultiplier * stdDev,
  };
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

  // Calculate core indicators
  const ema20 = calculateEMA(closes, 20);
  const ema50 = calculateEMA(closes, 50);
  const { k: stochK, d: stochD } = calculateStochastic(candles, 14, 3, 3);
  const { lowFractal, highFractal } = calculateFractals(candles);
  const atr = calculateATR(candles, 14);

  // Doji filter on the previous candle (candle at n-2, since n-1 is current)
  const prevCandle = candles[candles.length - 2];
  const pipValue = getPipValue(asset);
  const dojiThreshold = Math.max(2, atr * 0.1 / pipValue); // Adaptive: 2 pips or 10% of ATR
  const dojiRejected = prevCandle ? isDojiCandle(prevCandle, dojiThreshold, pipValue) : false;

  // If previous candle is a doji, reject signal
  if (dojiRejected) {
    return {
      direction: null,
      ema20, ema50, stochK, stochD, lowFractal, highFractal, dojiRejected, atr,
    };
  }

  // Proximity zone: price must be within 0.5 * ATR of EMA20 (retest zone)
  const proximityThreshold = atr * 0.5;
  const nearEma20 = Math.abs(currentPrice - ema20) <= proximityThreshold;

  // ============ CALL CONDITIONS ============
  // 1. Bullish trend: Price > EMA20 AND EMA20 > EMA50
  const callTrend = currentPrice > ema20 && ema20 > ema50;
  // 2. Price near EMA20 (pullback/retest)
  const callProximity = nearEma20;
  // 3. Stochastic oversold + bullish cross: %K < 20 AND %K > %D
  const callMomentum = stochK < 20 && stochK > stochD;
  // 4. Low fractal on previous candle
  const callReversal = lowFractal;

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
  // 3. Stochastic overbought + bearish cross: %K > 80 AND %K < %D
  const putMomentum = stochK > 80 && stochK < stochD;
  // 4. High fractal on previous candle
  const putReversal = highFractal;

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

  // -10% Barely in zone: Stochastic %K between 15-20 for CALL or 80-85 for PUT
  if (direction === "CALL" && stochK >= 15 && stochK < 20) confidence -= 10;
  if (direction === "PUT" && stochK > 80 && stochK <= 85) confidence -= 10;

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

  // Calculate legacy indicators for DB compatibility
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

// ============ MOCK CANDLE GENERATION ============

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
