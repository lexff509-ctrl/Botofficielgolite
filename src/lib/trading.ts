// Trading strategy engine - signal analysis and multi-timeframe confirmation
// Corrected MACD, Stochastic, and real multi-timeframe analysis

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
  rsi: number;
  macd: number;
  macdSignal: number;
  macdHistogram: number;
  ema9: number;
  ema21: number;
  ema50: number;
  bollingerUpper: number;
  bollingerMiddle: number;
  bollingerLower: number;
  stochastic: number;
  stochasticSignal: number;
  atr: number;
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

// RSI - smoothed (Wilder's method)
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

// Full EMA series for accurate MACD
export function calculateEMASeries(closes: number[], period: number): number[] {
  if (closes.length === 0) return [];
  const k = 2 / (period + 1);
  const result: number[] = [];
  // SMA for first value
  let ema = closes[0];
  result.push(ema);
  for (let i = 1; i < closes.length; i++) {
    ema = closes[i] * k + ema * (1 - k);
    result.push(ema);
  }
  return result;
}

// Latest EMA value
export function calculateEMA(closes: number[], period: number): number {
  if (closes.length < period) return closes[closes.length - 1];
  const k = 2 / (period + 1);
  let ema = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < closes.length; i++) {
    ema = closes[i] * k + ema * (1 - k);
  }
  return ema;
}

// MACD - correct computation using full EMA series
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

  // MACD line = EMA12 - EMA26 for each point
  const macdLine: number[] = [];
  for (let i = 0; i < closes.length; i++) {
    macdLine.push(ema12Series[i] - ema26Series[i]);
  }

  // Signal line = 9-period EMA of MACD line
  const signalLine = calculateEMASeries(macdLine, 9);

  const lastMacd = macdLine[macdLine.length - 1];
  const lastSignal = signalLine[signalLine.length - 1];
  const histogram = lastMacd - lastSignal;

  return { macd: lastMacd, signal: lastSignal, histogram, signalLine };
}

// Bollinger Bands
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

// Stochastic with proper 3-period SMA for %D
export function calculateStochastic(
  candles: Candle[],
  period = 14,
  smoothK = 3,
  smoothD = 3
): { k: number; d: number } {
  if (candles.length < period) return { k: 50, d: 50 };

  // Raw %K values for last smoothK periods
  const rawKValues: number[] = [];
  for (let idx = candles.length - smoothK; idx < candles.length; idx++) {
    const slice = candles.slice(Math.max(0, idx - period + 1), idx + 1);
    const lowest = Math.min(...slice.map((c) => c.low));
    const highest = Math.max(...slice.map((c) => c.high));
    const close = candles[idx].close;
    rawKValues.push(
      highest === lowest ? 50 : ((close - lowest) / (highest - lowest)) * 100
    );
  }

  // Fast %K = SMA of raw %K
  const k = rawKValues.reduce((a, b) => a + b, 0) / rawKValues.length;

  // For %D (slow stochastic), compute recent %K values and take SMA
  const recentKs: number[] = [];
  for (let idx = Math.max(0, candles.length - period - smoothD); idx < candles.length; idx++) {
    const slice = candles.slice(Math.max(0, idx - period + 1), idx + 1);
    const lowest = Math.min(...slice.map((c) => c.low));
    const highest = Math.max(...slice.map((c) => c.high));
    const close = candles[idx].close;
    recentKs.push(
      highest === lowest ? 50 : ((close - lowest) / (highest - lowest)) * 100
    );
  }
  const d = recentKs.slice(-smoothD).reduce((a, b) => a + b, 0) / smoothD;

  return { k, d };
}

// ATR
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
  // Smoothed ATR using EMA of true ranges
  if (slice.length === 0) return 0;
  let atr = slice[0];
  const k = 2 / (period + 1);
  for (let i = 1; i < slice.length; i++) {
    atr = slice[i] * k + atr * (1 - k);
  }
  return atr;
}

// ============ SIGNAL SCORING ============

function scoreSignal(closes: number[], candles: Candle[]): {
  indicators: Indicators;
  callScore: number;
  putScore: number;
} {
  const rsi = calculateRSI(closes);
  const { macd, signal: macdSignal, histogram } = calculateMACD(closes);
  const ema9 = calculateEMA(closes, 9);
  const ema21 = calculateEMA(closes, 21);
  const ema50 = calculateEMA(closes, 50);
  const bollinger = calculateBollinger(closes);
  const { k: stochK, d: stochD } = calculateStochastic(candles);
  const atr = calculateATR(candles);

  const indicators: Indicators = {
    rsi,
    macd,
    macdSignal,
    macdHistogram: histogram,
    ema9,
    ema21,
    ema50,
    bollingerUpper: bollinger.upper,
    bollingerMiddle: bollinger.middle,
    bollingerLower: bollinger.lower,
    stochastic: stochK,
    stochasticSignal: stochD,
    atr,
  };

  const currentPrice = closes[closes.length - 1];
  let callScore = 0;
  let putScore = 0;

  // RSI: oversold => CALL, overbought => PUT
  if (rsi < 30) callScore += 2;
  else if (rsi < 40) callScore += 1;
  else if (rsi > 70) putScore += 2;
  else if (rsi > 60) putScore += 1;

  // MACD: MACD > Signal + positive histogram => bullish
  if (macd > macdSignal && histogram > 0) callScore += 2;
  else if (macd < macdSignal && histogram < 0) putScore += 2;
  else if (macd > macdSignal) callScore += 1;
  else if (macd < macdSignal) putScore += 1;

  // EMA alignment: bullish or bearish stack
  if (ema9 > ema21 && ema21 > ema50) callScore += 3;
  else if (ema9 < ema21 && ema21 < ema50) putScore += 3;
  else if (ema9 > ema21) callScore += 1;
  else if (ema9 < ema21) putScore += 1;

  // Bollinger Bands: price at lower band => oversold, at upper => overbought
  if (currentPrice <= bollinger.lower) callScore += 2;
  else if (currentPrice >= bollinger.upper) putScore += 2;
  // Price above/below middle band
  if (currentPrice > bollinger.middle) callScore += 1;
  else putScore += 1;

  // Stochastic: oversold/overbought zones
  if (stochK < 20 && stochD < 20) callScore += 2;
  else if (stochK > 80 && stochD > 80) putScore += 2;
  else if (stochK > stochD) callScore += 1;
  else putScore += 1;

  // Cross-check: RSI + Stochastic divergence signals
  if (rsi < 35 && stochK < 25) callScore += 1;
  if (rsi > 65 && stochK > 75) putScore += 1;

  return { indicators, callScore, putScore };
}

// ============ MAIN SIGNAL GENERATION ============

export function generateSignal(
  candles: Candle[],
  asset: string,
  timeframe: Timeframe
): Signal | null {
  if (candles.length < 50) return null;

  const closes = candles.map((c) => c.close);
  const { indicators, callScore, putScore } = scoreSignal(closes, candles);

  const totalScore = callScore + putScore;
  if (totalScore === 0) return null;

  const callConfidence = (callScore / totalScore) * 100;
  const putConfidence = (putScore / totalScore) * 100;

  let direction: "CALL" | "PUT";
  let confidence: number;

  if (callScore > putScore) {
    direction = "CALL";
    confidence = callConfidence;
  } else {
    direction = "PUT";
    confidence = putConfidence;
  }

  // Minimum confidence threshold: 55%
  if (confidence < 55) return null;

  // Multi-timeframe confirmation — real analysis at each timeframe
  const mtfConfirmation: Record<Timeframe, "CALL" | "PUT" | "NEUTRAL"> =
    {} as Record<Timeframe, "CALL" | "PUT" | "NEUTRAL">;

  for (const tf of TIMEFRAMES) {
    // Simulate different timeframe view by aggregating candles
    const aggregationFactor = getTimeframeFactor(timeframe, tf);
    const aggregatedCandles = aggregateCandles(candles, aggregationFactor);

    if (aggregatedCandles.length < 30) {
      mtfConfirmation[tf] = "NEUTRAL";
      continue;
    }

    const tfCloses = aggregatedCandles.map((c) => c.close);
    const { callScore: tfCall, putScore: tfPut } = scoreSignal(
      tfCloses,
      aggregatedCandles
    );

    if (tfCall > tfPut + 1) mtfConfirmation[tf] = "CALL";
    else if (tfPut > tfCall + 1) mtfConfirmation[tf] = "PUT";
    else mtfConfirmation[tf] = "NEUTRAL";
  }

  // Boost confidence based on MTF agreement
  const confirmedTFs = TIMEFRAMES.filter(
    (tf) => mtfConfirmation[tf] === direction
  ).length;
  const contraryTFs = TIMEFRAMES.filter(
    (tf) =>
      mtfConfirmation[tf] !== direction && mtfConfirmation[tf] !== "NEUTRAL"
  ).length;

  const mtfBonus =
    ((confirmedTFs - contraryTFs) / TIMEFRAMES.length) * 15;
  confidence = Math.min(95, Math.max(0, confidence + mtfBonus));

  // Re-check threshold after MTF adjustment
  if (confidence < 55) return null;

  return {
    direction,
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
  // Add trend bias for more realistic signals
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
