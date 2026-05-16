/**
 * Pure technical-indicator functions.
 *
 * All functions operate on arrays of numbers (close prices or similar) and
 * return a single value or null when there is insufficient data.
 */

import type { Candle, SignalIndicators } from "@/types/trading";

// ─── RSI ─────────────────────────────────────────────────────────────────────

/**
 * Wilder's RSI.
 * @param closes  Array of close prices, oldest first.
 * @param period  Look-back period (default 14).
 */
export function rsi(closes: number[], period = 14): number | null {
  if (closes.length < period + 1) return null;

  let gains = 0;
  let losses = 0;

  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;

  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    const gain = diff >= 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

// ─── EMA ─────────────────────────────────────────────────────────────────────

/**
 * Exponential Moving Average.
 * Returns the EMA value at the last element of `closes`.
 */
export function ema(closes: number[], period: number): number | null {
  if (closes.length < period) return null;
  const k = 2 / (period + 1);
  let value = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < closes.length; i++) {
    value = closes[i] * k + value * (1 - k);
  }
  return value;
}

// ─── MACD ────────────────────────────────────────────────────────────────────

export interface MacdResult {
  macd: number;
  signal: number;
  histogram: number;
}

/**
 * MACD (12, 26, 9).
 */
export function macd(
  closes: number[],
  fastPeriod = 12,
  slowPeriod = 26,
  signalPeriod = 9
): MacdResult | null {
  if (closes.length < slowPeriod + signalPeriod) return null;

  // Build MACD line values
  const macdLine: number[] = [];
  for (let i = slowPeriod - 1; i < closes.length; i++) {
    const slice = closes.slice(0, i + 1);
    const fast = ema(slice, fastPeriod);
    const slow = ema(slice, slowPeriod);
    if (fast === null || slow === null) continue;
    macdLine.push(fast - slow);
  }

  if (macdLine.length < signalPeriod) return null;

  const signalLine = ema(macdLine, signalPeriod);
  if (signalLine === null) return null;

  const macdValue = macdLine[macdLine.length - 1];
  return {
    macd: macdValue,
    signal: signalLine,
    histogram: macdValue - signalLine,
  };
}

// ─── Bollinger Bands ─────────────────────────────────────────────────────────

export interface BollingerResult {
  upper: number;
  middle: number;
  lower: number;
}

/**
 * Bollinger Bands (20, 2).
 */
export function bollingerBands(
  closes: number[],
  period = 20,
  stdDevMultiplier = 2
): BollingerResult | null {
  if (closes.length < period) return null;
  const slice = closes.slice(-period);
  const middle = slice.reduce((a, b) => a + b, 0) / period;
  const variance =
    slice.reduce((sum, v) => sum + Math.pow(v - middle, 2), 0) / period;
  const stdDev = Math.sqrt(variance);
  return {
    upper: middle + stdDevMultiplier * stdDev,
    middle,
    lower: middle - stdDevMultiplier * stdDev,
  };
}

// ─── ATR ─────────────────────────────────────────────────────────────────────

/**
 * Average True Range.
 */
export function atr(candles: Candle[], period = 14): number | null {
  if (candles.length < period + 1) return null;
  const trs: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const high = candles[i].high;
    const low = candles[i].low;
    const prevClose = candles[i - 1].close;
    trs.push(Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose)));
  }
  return trs.slice(-period).reduce((a, b) => a + b, 0) / period;
}

// ─── Composite indicator snapshot ────────────────────────────────────────────

/**
 * Compute all indicators used by the signal engine from a candle series.
 */
export function computeIndicators(candles: Candle[]): SignalIndicators {
  const closes = candles.map((c) => c.close);
  const macdResult = macd(closes);
  const bb = bollingerBands(closes);
  const atrValue = atr(candles);

  return {
    rsi: rsi(closes) ?? undefined,
    macd: macdResult?.macd ?? undefined,
    macdSignal: macdResult?.signal ?? undefined,
    macdHistogram: macdResult?.histogram ?? undefined,
    ema9: ema(closes, 9) ?? undefined,
    ema21: ema(closes, 21) ?? undefined,
    bollingerUpper: bb?.upper ?? undefined,
    bollingerMiddle: bb?.middle ?? undefined,
    bollingerLower: bb?.lower ?? undefined,
    atr: atrValue ?? undefined,
  };
}
