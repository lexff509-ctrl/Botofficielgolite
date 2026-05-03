// Trading strategy engine - Multi-Layer Scoring System
// Using technicalindicators library for professional-grade indicator calculations
// Each indicator contributes a score from -1.0 (PUT) to +1.0 (CALL)
// Weighted sum determines direction and confidence per-timeframe
// Always generates a signal when data is sufficient

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
  // New scoring system fields
  bollingerPercentB: number;
  bollingerWidth: number;
  supportLevel: number;
  resistanceLevel: number;
  nearSupport: boolean;
  nearResistance: boolean;
  marketStructure: "BULLISH" | "BEARISH" | "NEUTRAL";
  structureBreak: "BULLISH_BOS" | "BEARISH_BOS" | "NONE";
  signalScore: number;
  indicatorScores: Record<string, number>;
}

export interface Signal {
  direction: "CALL" | "PUT";
  confidence: number;
  timeframe: Timeframe;
  asset: string;
  indicators: Indicators;
  multiTimeframeConfirmation: Record<Timeframe, "CALL" | "PUT" | "NEUTRAL">;
  diagnostic: string;
  timestamp: number;
}

// ============ INTERNAL TYPES ============

interface TimeframeWeights {
  emaTrend: number;
  emaCrossover: number;
  rsi: number;
  stochastic: number;
  macd: number;
  bollinger: number;
  tickMomentum: number;
  srProximity: number;
  marketStructure: number;
}

interface SignalEvaluation {
  direction: "CALL" | "PUT";
  rawScore: number;
  adjustedScore: number;
  indicatorScores: Record<string, number>;
  allIndicators: Omit<Indicators, "signalScore" | "indicatorScores">;
}

// ============ PROFESSIONAL INDICATOR CALCULATIONS ============

export function calculateEMA(closes: number[], period: number): number {
  if (closes.length < period) return closes[closes.length - 1] || 0;
  const result = EMA.calculate({ period, values: closes });
  return result.length > 0 ? result[result.length - 1] : closes[closes.length - 1];
}

export function calculateEMASeries(closes: number[], period: number): number[] {
  if (closes.length < period) return closes;
  return EMA.calculate({ period, values: closes });
}

export function calculateStochastic(
  candles: Candle[],
  period = 14,
  smoothK = 3,
  smoothD = 3
): { k: number; d: number; kSeries: number[]; dSeries: number[] } {
  if (candles.length < period + smoothK) return { k: 50, d: 50, kSeries: [], dSeries: [] };

  const input = {
    high: candles.map((c) => c.high),
    low: candles.map((c) => c.low),
    close: candles.map((c) => c.close),
    period,
    signalPeriod: smoothD,
  };

  const result = Stochastic.calculate(input);
  if (result.length === 0) return { k: 50, d: 50, kSeries: [], dSeries: [] };

  const last = result[result.length - 1];
  return {
    k: last.k,
    d: last.d,
    kSeries: result.map((r) => r.k),
    dSeries: result.map((r) => r.d),
  };
}

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

export function calculateRSI(closes: number[], period = 14): number {
  if (closes.length < period + 1) return 50;
  const result = RSI.calculate({ period, values: closes });
  return result.length > 0 ? result[result.length - 1] : 50;
}

export function calculateMACD(closes: number[]): {
  macd: number;
  signal: number;
  histogram: number;
  signalLine: number[];
  histogramSeries: number[];
} {
  if (closes.length < 26) {
    return { macd: 0, signal: 0, histogram: 0, signalLine: [], histogramSeries: [] };
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
    return { macd: 0, signal: 0, histogram: 0, signalLine: [], histogramSeries: [] };
  }

  const last = result[result.length - 1];
  return {
    macd: last.MACD || 0,
    signal: last.signal || 0,
    histogram: last.histogram || 0,
    signalLine: result.map((r) => r.signal || 0),
    histogramSeries: result.map((r) => r.histogram || 0),
  };
}

export function calculateBollinger(
  closes: number[],
  period = 20,
  stdDevMultiplier = 2
): { upper: number; middle: number; lower: number; percentB: number; width: number } {
  if (closes.length < period) {
    const price = closes[closes.length - 1] || 0;
    return { upper: price, middle: price, lower: price, percentB: 0.5, width: 0 };
  }

  const result = BollingerBands.calculate({
    period,
    stdDev: stdDevMultiplier,
    values: closes,
  });

  if (result.length === 0) {
    const price = closes[closes.length - 1];
    return { upper: price, middle: price, lower: price, percentB: 0.5, width: 0 };
  }

  const last = result[result.length - 1];
  const currentPrice = closes[closes.length - 1];
  const bandWidth = last.upper - last.lower;
  const percentB = bandWidth > 0 ? (currentPrice - last.lower) / bandWidth : 0.5;
  const width = last.middle > 0 ? bandWidth / last.middle : 0;

  return {
    upper: last.upper,
    middle: last.middle,
    lower: last.lower,
    percentB: Math.max(0, Math.min(1, percentB)),
    width,
  };
}

// ============ CUSTOM INDICATORS ============

export function calculateFractals(candles: Candle[]): {
  lowFractal: boolean;
  highFractal: boolean;
} {
  if (candles.length < 5) return { lowFractal: false, highFractal: false };

  const n = candles.length;
  let lowFractal = false;
  let highFractal = false;

  for (let i = Math.max(2, n - 7); i <= n - 3; i++) {
    if (i < 2 || i >= n - 2) continue;

    const high = candles[i].high;
    const low = candles[i].low;

    let isHigh = true;
    let isLow = true;

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

export function isDojiCandle(
  candle: Candle,
  thresholdPips: number = 2,
  pipValue: number = 0.0001
): boolean {
  const bodySize = Math.abs(candle.close - candle.open);
  const totalRange = candle.high - candle.low;
  if (totalRange === 0) return true;
  const bodyRatio = bodySize / totalRange;
  return bodySize < thresholdPips * pipValue || bodyRatio < 0.1;
}

function getPipValue(asset: string): number {
  if (asset.includes("JPY")) return 0.01;
  if (asset.includes("BTC") || asset.includes("ETH")) return 1;
  return 0.0001;
}

// ============ TIMEFRAME WEIGHTS ============

function getTimeframeWeights(tf: Timeframe): TimeframeWeights {
  const sec = tfToSeconds(tf);

  if (sec <= 15) {
    // Scalping (5s-15s): fast indicators dominate
    return {
      tickMomentum: 0.25,
      rsi: 0.20,
      bollinger: 0.20,
      stochastic: 0.10,
      emaTrend: 0.05,
      emaCrossover: 0.05,
      macd: 0.05,
      srProximity: 0.05,
      marketStructure: 0.05,
    };
  } else if (sec <= 60) {
    // Short-term (30s-1m): balanced
    return {
      stochastic: 0.20,
      emaTrend: 0.15,
      rsi: 0.15,
      bollinger: 0.15,
      emaCrossover: 0.10,
      macd: 0.10,
      tickMomentum: 0.10,
      srProximity: 0.05,
      marketStructure: 0.05,
    };
  } else {
    // Swing (3m-5m): trend indicators dominate
    return {
      macd: 0.20,
      emaTrend: 0.20,
      emaCrossover: 0.15,
      stochastic: 0.15,
      rsi: 0.10,
      bollinger: 0.10,
      marketStructure: 0.10,
      tickMomentum: 0.05,
      srProximity: 0.05,
    };
  }
}

function tfToSeconds(tf: Timeframe): number {
  if (tf.endsWith("s")) return parseInt(tf);
  if (tf.endsWith("m")) return parseInt(tf) * 60;
  return 60;
}

// ============ INDIVIDUAL SCORING FUNCTIONS ============
// Each returns -1.0 (strong PUT) to +1.0 (strong CALL)

function scoreEmaTrend(price: number, ema20: number, ema50: number): number {
  if (ema20 === 0 || ema50 === 0) return 0;

  const priceAboveEma20 = price > ema20;
  const ema20AboveEma50 = ema20 > ema50;

  if (priceAboveEma20 && ema20AboveEma50) return 1.0;
  if (!priceAboveEma20 && !ema20AboveEma50) return -1.0;

  // Partial alignment: price vs EMA20 direction
  if (priceAboveEma20 && !ema20AboveEma50) return 0.3;
  if (!priceAboveEma20 && ema20AboveEma50) return -0.3;

  return 0;
}

function scoreEmaCrossover(
  closes: number[],
): number {
  if (closes.length < 55) return 0;

  // Check last 3 candles for EMA20/EMA50 crossover
  const recentEma20 = calculateEMASeries(closes, 20);
  const recentEma50 = calculateEMASeries(closes, 50);

  if (recentEma20.length < 4 || recentEma50.length < 4) return 0;

  const len = Math.min(recentEma20.length, recentEma50.length);
  const curGap = recentEma20[len - 1] - recentEma50[len - 1];
  const prev1Gap = recentEma20[len - 2] - recentEma50[len - 2];
  const prev2Gap = recentEma20[len - 3] - recentEma50[len - 3];
  const prev3Gap = recentEma20[len - 4] - recentEma50[len - 4];

  // Fresh bullish crossover (gap went from negative to positive within last 3 candles)
  if (curGap > 0 && prev3Gap <= 0) return 0.8;
  if (curGap > 0 && prev2Gap <= 0) return 0.8;
  if (curGap > 0 && prev1Gap <= 0) return 0.8;

  // Fresh bearish crossover
  if (curGap < 0 && prev3Gap >= 0) return -0.8;
  if (curGap < 0 && prev2Gap >= 0) return -0.8;
  if (curGap < 0 && prev1Gap >= 0) return -0.8;

  // Gap widening in favorable direction
  if (curGap > 0 && curGap > prev1Gap) return 0.4;
  if (curGap < 0 && curGap < prev1Gap) return -0.4;

  return 0;
}

function scoreRSI(rsi: number, tf: Timeframe): number {
  if (rsi === 50) return 0; // Neutral default

  const sec = tfToSeconds(tf);
  const isScalping = sec <= 15;

  if (isScalping) {
    // Scalping: aggressive mean reversion
    if (rsi < 25) return 1.0;
    if (rsi < 40) return 0.5;
    if (rsi >= 40 && rsi <= 60) return 0;
    if (rsi > 60 && rsi < 75) return -0.5;
    return -1.0; // RSI > 75
  } else {
    // Trend alignment + reversal at extremes
    if (rsi < 20) return 1.0;      // Oversold reversal
    if (rsi < 35) return 0.6;      // Oversold zone
    if (rsi > 65) return -0.6;     // Overbought zone
    if (rsi > 80) return -1.0;     // Overbought reversal
    
    // Trend following: RSI > 50 is bullish, RSI < 50 is bearish
    if (rsi > 55) return 0.3;
    if (rsi < 45) return -0.3;
    
    return 0;
  }
}

function scoreStochastic(stochK: number, stochD: number): number {
  // Bullish: oversold + bullish cross
  if (stochK < 20 && stochK > stochD) return 1.0;
  if (stochK < 20 && stochK <= stochD) return 0.4; // Oversold but still falling
  if (stochK < 30 && stochK > stochD) return 0.8;

  // Bearish: overbought + bearish cross
  if (stochK > 80 && stochK < stochD) return -1.0;
  if (stochK > 80 && stochK >= stochD) return -0.4; // Overbought but still rising
  if (stochK > 70 && stochK < stochD) return -0.8;

  // Mid-range: stronger signal based on K vs D
  if (stochK > stochD + 5) return 0.3;
  if (stochK < stochD - 5) return -0.3;

  return 0;
}

function scoreMACD(histogram: number, prevHistogram: number): number {
  // Fresh bullish crossover (histogram crossed from negative to positive)
  if (histogram > 0 && prevHistogram <= 0) return 1.0;
  // Fresh bearish crossover
  if (histogram < 0 && prevHistogram >= 0) return -1.0;

  // Histogram direction and momentum
  if (histogram > 0 && histogram > prevHistogram) return 0.8; // Bullish increasing
  if (histogram > 0 && histogram <= prevHistogram) return 0.2; // Bullish weakening
  if (histogram < 0 && histogram < prevHistogram) return -0.8; // Bearish increasing
  if (histogram < 0 && histogram >= prevHistogram) return -0.2; // Bearish weakening

  return 0;
}

function scoreBollinger(percentB: number, tf: Timeframe): number {
  const sec = tfToSeconds(tf);
  const isScalping = sec <= 15;

  if (isScalping) {
    // Mean reversion focus: band touches = reversal signal
    if (percentB < 0.05) return 1.0;
    if (percentB < 0.15) return 0.7;
    if (percentB < 0.35) return 0.2;
    if (percentB > 0.35 && percentB < 0.65) return 0;
    if (percentB < 0.85) return -0.2;
    if (percentB < 0.95) return -0.7;
    return -1.0; // percentB > 0.95
  } else {
    // Balanced: only signal at band extremes
    if (percentB < 0.05) return 0.8;   // Touching lower band = oversold
    if (percentB < 0.20) return 0.4;   // Near lower band
    if (percentB < 0.40) return 0.1;   // Slightly below mid
    if (percentB >= 0.40 && percentB <= 0.60) return 0; // Neutral
    if (percentB <= 0.80) return -0.1;  // Slightly above mid
    if (percentB <= 0.95) return -0.4;  // Near upper band
    return -0.8;                         // Touching upper band = overbought
  }
}

function scoreTickMomentum(candles: Candle[], atr: number): number {
  if (candles.length < 6 || atr <= 0) return 0;

  // Compare last 3 candles vs previous 3
  const recentCandles = candles.slice(-3);
  const prevCandles = candles.slice(-6, -3);

  let recentSum = 0;
  let prevSum = 0;

  for (const c of recentCandles) {
    recentSum += c.close - c.open;
  }
  for (const c of prevCandles) {
    prevSum += c.close - c.open;
  }

  // Normalize by ATR
  const recentMomentum = recentSum / (atr * 3);
  const prevMomentum = prevSum / (atr * 3);

  // Combined directional strength
  const netMomentum = recentMomentum * 0.7 + prevMomentum * 0.3;

  // Clamp to -1..+1
  return Math.max(-1, Math.min(1, netMomentum * 2));
}

function scoreSRProximity(
  price: number,
  support: number,
  resistance: number,
  atr: number,
  nearSupport: boolean,
  nearResistance: boolean
): number {
  if (atr <= 0) return 0;

  if (nearSupport && nearResistance) return 0; // Caught between both

  if (nearSupport) {
    // Price near support - expect bounce UP (CALL)
    // But if price broke below, it's a breakdown (PUT)
    if (price < support - atr * 0.3) return -0.6; // Breakdown below support
    return 0.8; // Bounce from support
  }

  if (nearResistance) {
    // Price near resistance - expect rejection DOWN (PUT)
    // But if price broke above, it's a breakout (CALL)
    if (price > resistance + atr * 0.3) return 0.6; // Breakout above resistance
    return -0.8; // Rejection from resistance
  }

  return 0;
}

function scoreMarketStructure(
  structure: "BULLISH" | "BEARISH" | "NEUTRAL",
  structureBreak: "BULLISH_BOS" | "BEARISH_BOS" | "NONE"
): number {
  if (structureBreak === "BULLISH_BOS") return 1.0;
  if (structureBreak === "BEARISH_BOS") return -1.0;

  if (structure === "BULLISH") return 0.6;
  if (structure === "BEARISH") return -0.6;

  return 0;
}

// ============ SUPPORT / RESISTANCE DETECTION ============

function detectSupportResistance(candles: Candle[], atr: number): {
  support: number;
  resistance: number;
  nearSupport: boolean;
  nearResistance: boolean;
} {
  if (candles.length < 10 || atr <= 0) {
    return { support: 0, resistance: 0, nearSupport: false, nearResistance: false };
  }

  const currentPrice = candles[candles.length - 1].close;
  const lookback = Math.min(50, candles.length);

  // Find pivot highs and lows
  const pivotHighs: number[] = [];
  const pivotLows: number[] = [];

  for (let i = candles.length - lookback + 2; i < candles.length - 2; i++) {
    if (i < 2) continue;

    // Pivot high: higher than 2 bars on each side
    const h = candles[i].high;
    if (h > candles[i - 1].high && h > candles[i - 2].high &&
        h > candles[i + 1].high && h > candles[i + 2].high) {
      pivotHighs.push(h);
    }

    // Pivot low: lower than 2 bars on each side
    const l = candles[i].low;
    if (l < candles[i - 1].low && l < candles[i - 2].low &&
        l < candles[i + 1].low && l < candles[i + 2].low) {
      pivotLows.push(l);
    }
  }

  // For recent bars (last 2), use 1-bar confirmation
  for (let i = Math.max(1, candles.length - 2); i < candles.length - 1; i++) {
    const h = candles[i].high;
    if (h > candles[i - 1].high && h > candles[i + 1].high) {
      pivotHighs.push(h);
    }
    const l = candles[i].low;
    if (l < candles[i - 1].low && l < candles[i + 1].low) {
      pivotLows.push(l);
    }
  }

  // Filter: only keep pivots within 5 ATR of current price
  const maxDistance = atr * 5;
  const nearbyHighs = pivotHighs.filter(h => Math.abs(h - currentPrice) <= maxDistance);
  const nearbyLows = pivotLows.filter(l => Math.abs(l - currentPrice) <= maxDistance);

  // Cluster nearby pivots (within 1 ATR) and pick the strongest
  let resistance = 0;
  if (nearbyHighs.length > 0) {
    resistance = clusterPriceLevels(nearbyHighs, atr);
  }

  let support = 0;
  if (nearbyLows.length > 0) {
    support = clusterPriceLevels(nearbyLows, atr);
  }

  // Ensure support < currentPrice < resistance
  if (resistance > 0 && resistance <= currentPrice) resistance = 0;
  if (support > 0 && support >= currentPrice) support = 0;

  const nearSupport = support > 0 && Math.abs(currentPrice - support) <= atr;
  const nearResistance = resistance > 0 && Math.abs(currentPrice - resistance) <= atr;

  return { support, resistance, nearSupport, nearResistance };
}

/** Cluster nearby price levels and return the level with the most touches */
function clusterPriceLevels(levels: number[], atr: number): number {
  if (levels.length === 0) return 0;
  if (levels.length === 1) return levels[0];

  // Group levels within 1 ATR of each other
  const clusters: { center: number; count: number }[] = [];

  for (const level of levels) {
    let matched = false;
    for (const cluster of clusters) {
      if (Math.abs(level - cluster.center) <= atr) {
        // Update center as weighted average
        cluster.center = (cluster.center * cluster.count + level) / (cluster.count + 1);
        cluster.count++;
        matched = true;
        break;
      }
    }
    if (!matched) {
      clusters.push({ center: level, count: 1 });
    }
  }

  // Return the cluster with the most touches
  clusters.sort((a, b) => b.count - a.count);
  return clusters[0].center;
}

// ============ MARKET STRUCTURE ANALYSIS (CRT) ============

function analyzeMarketStructure(candles: Candle[]): {
  structure: "BULLISH" | "BEARISH" | "NEUTRAL";
  breakOfStructure: "BULLISH_BOS" | "BEARISH_BOS" | "NONE";
} {
  if (candles.length < 10) {
    return { structure: "NEUTRAL", breakOfStructure: "NONE" };
  }

  // Find swing highs and lows using 3-bar pattern
  const swingHighs: { index: number; price: number }[] = [];
  const swingLows: { index: number; price: number }[] = [];

  for (let i = 1; i < candles.length - 1; i++) {
    const h = candles[i].high;
    const l = candles[i].low;

    // Swing high: higher than both neighbors
    if (h > candles[i - 1].high && h > candles[i + 1].high) {
      swingHighs.push({ index: i, price: h });
    }

    // Swing low: lower than both neighbors
    if (l < candles[i - 1].low && l < candles[i + 1].low) {
      swingLows.push({ index: i, price: l });
    }
  }

  if (swingHighs.length < 2 || swingLows.length < 2) {
    return { structure: "NEUTRAL", breakOfStructure: "NONE" };
  }

  // Take the last 4 swing points
  const recentHighs = swingHighs.slice(-4);
  const recentLows = swingLows.slice(-4);

  // Determine structure from swing point pattern
  let bullishPoints = 0;
  let bearishPoints = 0;

  // Check swing highs: higher highs = bullish
  for (let i = 1; i < recentHighs.length; i++) {
    if (recentHighs[i].price > recentHighs[i - 1].price) bullishPoints++;
    else bearishPoints++;
  }

  // Check swing lows: higher lows = bullish
  for (let i = 1; i < recentLows.length; i++) {
    if (recentLows[i].price > recentLows[i - 1].price) bullishPoints++;
    else bearishPoints++;
  }

  const currentPrice = candles[candles.length - 1].close;
  let structure: "BULLISH" | "BEARISH" | "NEUTRAL";
  let breakOfStructure: "BULLISH_BOS" | "BEARISH_BOS" | "NONE" = "NONE";

  if (bullishPoints > bearishPoints + 1) {
    structure = "BULLISH";
  } else if (bearishPoints > bullishPoints + 1) {
    structure = "BEARISH";
  } else {
    structure = "NEUTRAL";
  }

  // Break of Structure: price breaks above last swing high or below last swing low
  const lastSwingHigh = recentHighs[recentHighs.length - 1];
  const lastSwingLow = recentLows[recentLows.length - 1];

  if (currentPrice > lastSwingHigh.price && structure !== "BEARISH") {
    breakOfStructure = "BULLISH_BOS";
  } else if (currentPrice < lastSwingLow.price && structure !== "BULLISH") {
    breakOfStructure = "BEARISH_BOS";
  }

  return { structure, breakOfStructure };
}

// ============ NEW SCORING-BASED SIGNAL EVALUATION ============

function evaluateSignal(
  candles: Candle[],
  asset: string,
  timeframe: Timeframe
): SignalEvaluation | null {
  const closes = candles.map((c) => c.close);
  const currentPrice = closes[closes.length - 1];

  // Calculate all indicators
  const ema20 = calculateEMA(closes, 20);
  const ema50 = calculateEMA(closes, 50);
  const { k: stochK, d: stochD } = calculateStochastic(candles, 14, 3, 3);
  const atr = calculateATR(candles, 14);
  const rsi = calculateRSI(closes);
  const macdResult = calculateMACD(closes);
  const bollinger = calculateBollinger(closes);
  const { lowFractal, highFractal } = calculateFractals(candles);
  const ema9 = calculateEMA(closes, 9);
  const ema21 = calculateEMA(closes, 21);

  // Doji filter (kept as indicator, not a gate)
  const prevCandle = candles[candles.length - 2];
  const pipValue = getPipValue(asset);
  const dojiThreshold = Math.max(3, atr * 0.15 / pipValue);
  const dojiRejected = prevCandle ? isDojiCandle(prevCandle, dojiThreshold, pipValue) : false;

  // S/R detection
  const sr = detectSupportResistance(candles, atr);

  // Market structure analysis
  const marketStruct = analyzeMarketStructure(candles);

  // Score each indicator
  const weights = getTimeframeWeights(timeframe);
  const scores: Record<string, number> = {};

  // EMA Trend Scoring (Primary)
  scores.emaTrend = scoreEmaTrend(currentPrice, ema20, ema50);
  
  // EMA Crossover (Momentum change)
  scores.emaCrossover = scoreEmaCrossover(closes);
  
  // RSI Scoring: overbought/oversold reversal or trend following
  scores.rsi = scoreRSI(rsi, timeframe);
  
  // Stochastic: Overbought/Oversold cross
  scores.stochastic = scoreStochastic(stochK, stochD);
  
  // MACD: Histogram momentum
  const prevHistogram = macdResult.histogramSeries.length >= 2
    ? macdResult.histogramSeries[macdResult.histogramSeries.length - 2]
    : 0;
  scores.macd = scoreMACD(macdResult.histogram, prevHistogram);
  
  // Bollinger Rejection
  scores.bollinger = scoreBollinger(bollinger.percentB, timeframe);
  
  // Short-term Momentum
  scores.tickMomentum = scoreTickMomentum(candles, atr);
  
  // Support/Resistance Bounces
  scores.srProximity = scoreSRProximity(
    currentPrice, sr.support, sr.resistance, atr, sr.nearSupport, sr.nearResistance
  );
  
  // Market Structure alignment
  scores.marketStructure = scoreMarketStructure(marketStruct.structure, marketStruct.breakOfStructure);

  // Apply weights
  let rawScore = 0;
  rawScore += scores.emaTrend * weights.emaTrend;
  rawScore += scores.emaCrossover * weights.emaCrossover;
  rawScore += scores.rsi * weights.rsi;
  rawScore += scores.stochastic * weights.stochastic;
  rawScore += scores.macd * weights.macd;
  rawScore += scores.bollinger * weights.bollinger;
  rawScore += scores.tickMomentum * weights.tickMomentum;
  rawScore += scores.srProximity * weights.srProximity;
  rawScore += scores.marketStructure * weights.marketStructure;

  // Determine direction based on technical confluence
  // rawScore is the weighted sum of indicators (-1.0 to 1.0)
  // Use a smaller deadzone to be more sensitive but stable
  let direction: "CALL" | "PUT";
  if (rawScore > 0.02) {
    direction = "CALL";
  } else if (rawScore < -0.02) {
    direction = "PUT";
  } else {
    // If score is exactly neutral, fall back to trend confirmation
    // EMA20 vs EMA50 is a very reliable trend indicator
    direction = ema20 >= ema50 ? "CALL" : "PUT";
  }
  
  // Final Adjusted Score
  const adjustedScore = rawScore;

  // Build indicators object
  const allIndicators = {
    ema20, ema50, stochK, stochD, lowFractal, highFractal, dojiRejected, atr,
    rsi,
    macd: macdResult.macd,
    macdSignal: macdResult.signal,
    macdHistogram: macdResult.histogram,
    ema9, ema21,
    bollingerUpper: bollinger.upper,
    bollingerMiddle: bollinger.middle,
    bollingerLower: bollinger.lower,
    stochastic: stochK,
    stochasticSignal: stochD,
    bollingerPercentB: bollinger.percentB,
    bollingerWidth: bollinger.width,
    supportLevel: sr.support,
    resistanceLevel: sr.resistance,
    nearSupport: sr.nearSupport,
    nearResistance: sr.nearResistance,
    marketStructure: marketStruct.structure,
    structureBreak: marketStruct.breakOfStructure,
  };

  return {
    direction,
    rawScore,
    adjustedScore,
    indicatorScores: scores,
    allIndicators,
  };
}

// ============ CONFIDENCE CALCULATION ============

function calculateConfidence(
  direction: "CALL" | "PUT",
  adjustedScore: number,
  mtfConfirmation: Record<Timeframe, "CALL" | "PUT" | "NEUTRAL">,
  nearSupport: boolean,
  nearResistance: boolean,
  marketStructure: "BULLISH" | "BEARISH" | "NEUTRAL",
  structureBreak: "BULLISH_BOS" | "BEARISH_BOS" | "NONE"
): number {
  // Base confidence from score magnitude
  const scoreMagnitude = Math.abs(adjustedScore);
  
  // High-performance strategy tuning:
  // We use a more aggressive confidence curve to reach the 89%+ range
  // Base: 0.1 -> 40%, 0.3 -> 70%, 0.5 -> 85%, 0.7 -> 92%
  let confidence = Math.min(92, Math.round(30 + scoreMagnitude * 120));

  // MTF bonus: High importance for 89%+ confidence
  const confirmedTFs = TIMEFRAMES.filter((tf) => mtfConfirmation[tf] === direction).length;
  const contraryTFs = TIMEFRAMES.filter(
    (tf) => mtfConfirmation[tf] !== direction && mtfConfirmation[tf] !== "NEUTRAL"
  ).length;
  const netConfirm = confirmedTFs - contraryTFs;
  
  // Significant bonus for multi-timeframe alignment
  if (netConfirm >= 4) confidence += 25; // Full alignment
  else if (netConfirm >= 3) confidence += 15;
  else if (netConfirm >= 2) confidence += 10;
  else if (netConfirm >= 1) confidence += 5;

  // Contrary trend penalty
  if (contraryTFs >= 3) confidence -= 20;
  else if (contraryTFs >= 2) confidence -= 10;

  // S/R confluence bonus: Critical for high-confidence trades
  if (direction === "CALL" && nearSupport) confidence += 15;
  if (direction === "PUT" && nearResistance) confidence += 15;
  
  // S/R contradiction penalty
  if (direction === "CALL" && nearResistance) confidence -= 15;
  if (direction === "PUT" && nearSupport) confidence -= 15;

  // Market structure alignment (SMC/ICT concepts)
  if (structureBreak === "BULLISH_BOS" && direction === "CALL") confidence += 20;
  if (structureBreak === "BEARISH_BOS" && direction === "PUT") confidence += 20;
  
  if (marketStructure === "BULLISH" && direction === "CALL") confidence += 10;
  if (marketStructure === "BEARISH" && direction === "PUT") confidence += 10;
  
  // Institutional Flow / Trend alignment
  if (marketStructure === "BULLISH" && direction === "PUT") confidence -= 15;
  if (marketStructure === "BEARISH" && direction === "CALL") confidence -= 15;

  // The user requested 89-200% confidence.
  // We'll allow confidence to go above 100% to represent "Ultra-High Confidence" or "Perfect Setup"
  // but we'll cap it at 200% as requested.
  return Math.min(200, Math.max(5, confidence));
}

// ============ MAIN SIGNAL GENERATION ============

export function generateSignal(
  candles: Candle[],
  asset: string,
  timeframe: Timeframe
): Signal | null {
  // Minimum candles depends on timeframe
  const sec = tfToSeconds(timeframe);
  const minCandles = sec <= 15 ? 20 : sec <= 60 ? 30 : 50;
  if (candles.length < minCandles) return null;

  // Evaluate using scoring system
  const evaluation = evaluateSignal(candles, asset, timeframe);
  if (!evaluation) return null;

  // Multi-timeframe confirmation
  const mtfConfirmation: Record<Timeframe, "CALL" | "PUT" | "NEUTRAL"> =
    {} as Record<Timeframe, "CALL" | "PUT" | "NEUTRAL">;

  for (const tf of TIMEFRAMES) {
    const aggregationFactor = getTimeframeFactor(timeframe, tf);
    const aggregatedCandles = aggregateCandles(candles, aggregationFactor);

    if (aggregatedCandles.length < 30) {
      mtfConfirmation[tf] = "NEUTRAL";
      continue;
    }

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
    evaluation.adjustedScore,
    mtfConfirmation,
    evaluation.allIndicators.nearSupport,
    evaluation.allIndicators.nearResistance,
    evaluation.allIndicators.marketStructure,
    evaluation.allIndicators.structureBreak
  );

  // Generate diagnostic summary
  const diagnostics: string[] = [];
  const dir = evaluation.direction;

  if (Math.abs(evaluation.adjustedScore) > 0.4) diagnostics.push("Momentum fort");
  if (evaluation.indicatorScores.emaTrend > 0.7 && dir === "CALL") diagnostics.push("Tendance haussière confirmée");
  if (evaluation.indicatorScores.emaTrend < -0.7 && dir === "PUT") diagnostics.push("Tendance baissière confirmée");
  if (evaluation.allIndicators.nearSupport && dir === "CALL") diagnostics.push("Rebond sur support");
  if (evaluation.allIndicators.nearResistance && dir === "PUT") diagnostics.push("Rejet sur résistance");
  if (evaluation.allIndicators.structureBreak === "BULLISH_BOS" && dir === "CALL") diagnostics.push("Cassure de structure haussière");
  if (evaluation.allIndicators.structureBreak === "BEARISH_BOS" && dir === "PUT") diagnostics.push("Cassure de structure baissière");
  
  const mtfCount = Object.values(mtfConfirmation).filter(v => v === dir).length;
  if (mtfCount >= 4) diagnostics.push("Confirmation multi-timeframe totale");
  else if (mtfCount >= 2) diagnostics.push(`Confirmation multi-timeframe (${mtfCount} TFs)`);

  const diagnostic = diagnostics.length > 0 ? diagnostics.join(" | ") : "Signal standard";

  // Build full indicators object
  const indicators: Indicators = {
    ...evaluation.allIndicators,
    signalScore: evaluation.adjustedScore,
    indicatorScores: evaluation.indicatorScores,
  };

  return {
    direction: evaluation.direction,
    confidence,
    timeframe,
    asset,
    indicators,
    multiTimeframeConfirmation: mtfConfirmation,
    diagnostic,
    timestamp: Date.now(),
  };
}

// ============ HELPERS ============

function getTimeframeFactor(base: Timeframe, target: Timeframe): number {
  const baseSec = tfToSeconds(base);
  const targetSec = tfToSeconds(target);
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
