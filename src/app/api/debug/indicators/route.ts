import { NextResponse } from "next/server";
import { candleCache } from "@/lib/candle-cache";
import {
  generateSignal,
  calculateEMA,
  calculateStochastic,
  calculateATR,
  calculateFractals,
  isDojiCandle,
  type Candle,
} from "@/lib/trading";

// Detect bullish/bearish reversal candle (same as in trading.ts)
function detectReversalCandle(candles: Candle[]) {
  if (candles.length < 2) return { bullishReversal: false, bearishReversal: false };
  const prev = candles[candles.length - 2];
  const body = Math.abs(prev.close - prev.open);
  const range = prev.high - prev.low;
  if (range === 0) return { bullishReversal: false, bearishReversal: false };
  const bodyRatio = body / range;
  const lowerWick = Math.min(prev.open, prev.close) - prev.low;
  const lowerWickRatio = lowerWick / range;
  const upperWick = prev.high - Math.max(prev.open, prev.close);
  const upperWickRatio = upperWick / range;
  return {
    bullishReversal: lowerWickRatio > 0.5 && bodyRatio < 0.4,
    bearishReversal: upperWickRatio > 0.5 && bodyRatio < 0.4,
  };
}

export async function GET() {
  const candles = candleCache.getCandlesForTimeframe("EUR/USD", "1m", 100);

  if (candles.length < 50) {
    return NextResponse.json({
      error: "Not enough candles",
      count: candles.length,
      cache: candleCache.getStatus(),
    });
  }

  const closes = candles.map((c) => c.close);
  const currentPrice = closes[closes.length - 1];

  const ema20 = calculateEMA(closes, 20);
  const ema50 = calculateEMA(closes, 50);
  const stoch = calculateStochastic(candles, 14, 3, 3);
  const atr = calculateATR(candles, 14);
  const fractals = calculateFractals(candles);
  const reversal = detectReversalCandle(candles);

  const prevCandle = candles[candles.length - 2];
  const pipValue = 0.0001;
  const dojiThreshold = Math.max(3, (atr * 0.15) / pipValue);
  const dojiRejected = prevCandle ? isDojiCandle(prevCandle, dojiThreshold, pipValue) : false;

  const proximityThreshold = atr * 1.0;
  const nearEma20 = Math.abs(currentPrice - ema20) <= proximityThreshold;

  // CALL conditions (updated)
  const callTrend = currentPrice > ema20 && ema20 > ema50;
  const callProximity = nearEma20;
  const callMomentum = stoch.k < 30 && stoch.k > stoch.d;
  const callReversal = fractals.lowFractal || reversal.bullishReversal;
  const callAll = callTrend && callProximity && callMomentum && callReversal;

  // PUT conditions (updated)
  const putTrend = currentPrice < ema20 && ema20 < ema50;
  const putProximity = nearEma20;
  const putMomentum = stoch.k > 70 && stoch.k < stoch.d;
  const putReversal = fractals.highFractal || reversal.bearishReversal;
  const putAll = putTrend && putProximity && putMomentum && putReversal;

  const signal = generateSignal(candles, "EUR/USD", "1m");

  return NextResponse.json({
    timestamp: new Date().toISOString(),
    candlesCount: candles.length,
    cache: candleCache.getStatus(),
    price: currentPrice,
    indicators: {
      ema20, ema50,
      stochK: stoch.k, stochD: stoch.d,
      atr,
      lowFractal: fractals.lowFractal,
      highFractal: fractals.highFractal,
      bullishReversal: reversal.bullishReversal,
      bearishReversal: reversal.bearishReversal,
      dojiRejected,
    },
    callConditions: {
      trend: callTrend,
      proximity: callProximity,
      momentum: callMomentum,
      reversal: callReversal,
      all: callAll,
    },
    putConditions: {
      trend: putTrend,
      proximity: putProximity,
      momentum: putMomentum,
      reversal: putReversal,
      all: putAll,
    },
    proximityDetail: {
      distanceToEma20: Math.abs(currentPrice - ema20),
      threshold: proximityThreshold,
      near: nearEma20,
    },
    stochasticDetail: {
      k: stoch.k, d: stoch.d,
      oversold: stoch.k < 30,
      overbought: stoch.k > 70,
      bullishCross: stoch.k > stoch.d,
      bearishCross: stoch.k < stoch.d,
    },
    signal: signal ? { direction: signal.direction, confidence: signal.confidence } : null,
  });
}
