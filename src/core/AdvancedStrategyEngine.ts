import {
  EMA,
  SMA,
  RSI,
  MACD,
  Stochastic,
  BollingerBands,
  ATR,
  ADX,
  CCI,
  WilliamsR,
  ROC,
  OBV,
  VWAP,
  PSAR,
  IchimokuCloud
} from "technicalindicators";

export type Timeframe = "5s" | "10s" | "15s" | "30s" | "1m" | "3m" | "5m";

export interface Candle {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  timestamp: number;
}

export interface SignalResult {
  signal: "BUY" | "SELL" | "WAIT";
  confidence: "HIGH" | "MEDIUM" | "LOW";
  score: number;
  reason: string;
  isReversal: boolean;
  metrics: any;
}

export class AdvancedStrategyEngine {
  
  /**
   * Evaluate Non-OTC Markets (Binance/TwelveData)
   * Focuses on Reversals, Market Structure, Volume, and the exact 20 indicators.
   */
  public static evaluateNonOtc(candles: Candle[], timeframe: Timeframe, isBinance: boolean = false): SignalResult {
    if (candles.length < 30) {
      return { signal: "WAIT", confidence: "LOW", score: 0, reason: "Données insuffisantes", isReversal: false, metrics: {} };
    }

    const closes = candles.map(c => c.close);
    const highs = candles.map(c => c.high);
    const lows = candles.map(c => c.low);
    const opens = candles.map(c => c.open);
    const volumes = candles.map(c => c.volume);
    const currentPrice = closes[closes.length - 1];
    
    // Timeframe context
    const isMicroScalping = timeframe === "5s" || timeframe === "10s" || timeframe === "15s" || timeframe === "30s";
    
    const getS = (res: any[]) => res.length > 0 ? res[res.length - 1] : null;

    // --- 20 EXACT INDICATORS ---
    const ema = getS(EMA.calculate({ period: 9, values: closes })) || currentPrice;
    const sma = getS(SMA.calculate({ period: 50, values: closes })) || currentPrice;
    const rsi = getS(RSI.calculate({ period: 14, values: closes })) || 50;
    const macdData = getS(MACD.calculate({ fastPeriod: 12, slowPeriod: 26, signalPeriod: 9, values: closes, SimpleMAOscillator: false, SimpleMASignal: false })) || { MACD: 0, signal: 0, histogram: 0 };
    const stochData = getS(Stochastic.calculate({ high: highs, low: lows, close: closes, period: 14, signalPeriod: 3 })) || { k: 50, d: 50 };
    const bb = getS(BollingerBands.calculate({ period: 20, stdDev: 2, values: closes })) || { upper: currentPrice, middle: currentPrice, lower: currentPrice };
    const atr = getS(ATR.calculate({ high: highs, low: lows, close: closes, period: 14 })) || 0;
    const adxData = getS(ADX.calculate({ high: highs, low: lows, close: closes, period: 14 })) || { adx: 0, pdi: 0, mdi: 0 };
    const cci = getS(CCI.calculate({ high: highs, low: lows, close: closes, period: 20 })) || 0;
    const wr = getS(WilliamsR.calculate({ high: highs, low: lows, close: closes, period: 14 })) || -50;
    const roc = getS(ROC.calculate({ period: 12, values: closes })) || 0;
    const obv = getS(OBV.calculate({ close: closes, volume: volumes })) || 0;
    const vwap = getS(VWAP.calculate({ high: highs, low: lows, close: closes, volume: volumes })) || currentPrice;
    const psar = getS(PSAR.calculate({ step: 0.02, max: 0.2, high: highs, low: lows })) || currentPrice;
    const ichi = getS(IchimokuCloud.calculate({ high: highs, low: lows, conversionPeriod: 9, basePeriod: 26, spanPeriod: 52, displacement: 26 })) || { spanA: currentPrice, spanB: currentPrice };
    
    // Custom Fibonacci, S/R, HA, SuperTrend
    const min30 = Math.min(...lows.slice(-30));
    const max30 = Math.max(...highs.slice(-30));
    const diff = max30 - min30;
    const fib0382 = max30 - diff * 0.382;
    const fib0618 = max30 - diff * 0.618;
    const isSupport = lows[candles.length - 2] < lows[candles.length - 3] && lows[candles.length - 2] < lows[candles.length - 1];
    const isResistance = highs[candles.length - 2] > highs[candles.length - 3] && highs[candles.length - 2] > highs[candles.length - 1];
    const isSuperTrendBullish = currentPrice > ema; // proxy
    const haClose = (opens[opens.length-1] + highs[highs.length-1] + lows[lows.length-1] + closes[closes.length-1]) / 4;
    const haOpen = (opens[opens.length-2] + closes[closes.length-2]) / 2; 
    const isHaBullish = haClose > haOpen;

    let buyPoints = 0;
    let sellPoints = 0;
    let isReversal = false;
    let reversalScore = 0;

    const check = (buyC: boolean, sellC: boolean, weight: number = 1) => {
      if (buyC) buyPoints += weight;
      else if (sellC) sellPoints += weight;
    };

    if (isMicroScalping) {
      // 🚀 MICRO-SCALPING & REVERSAL LOGIC (5s, 15s, 30s)
      // Focus: Mean reversion, exhaustion, quick bounces on VWAP/BB, fast oscillator crosses.
      
      // 1. Extreme Price Action Rejection (Pinbars / Dojis after run)
      const body = Math.abs(closes[closes.length-1] - opens[opens.length-1]);
      const upperWick = highs[highs.length-1] - Math.max(closes[closes.length-1], opens[opens.length-1]);
      const lowerWick = Math.min(closes[closes.length-1], opens[opens.length-1]) - lows[lows.length-1];
      
      const isBullishPinbar = lowerWick > body * 2 && upperWick < body;
      const isBearishPinbar = upperWick > body * 2 && lowerWick < body;
      check(isBullishPinbar && currentPrice < bb.lower, isBearishPinbar && currentPrice > bb.upper, 3);

      // 2. Fast Oscillator Snapping (Stoch Cross in extreme zones)
      const stochCrossUp = stochData.k > stochData.d && stochData.k < 30;
      const stochCrossDown = stochData.k < stochData.d && stochData.k > 70;
      check(stochCrossUp, stochCrossDown, 2);

      // 3. Volatility Compression Breakout (Bollinger Squeeze)
      const isSqueeze = (bb.upper - bb.lower) / bb.middle < 0.002;
      check(isSqueeze && currentPrice > ema, isSqueeze && currentPrice < ema, 2);

      // 4. VWAP Magnet Effect (Price tends to revert to VWAP in short timeframes)
      // If price is very far from VWAP, it snaps back. If it's crossing, it continues.
      const distVwap = Math.abs(currentPrice - vwap) / vwap;
      const extremeVwap = distVwap > 0.0015; // 0.15% deviation in seconds is huge
      check(extremeVwap && currentPrice < vwap, extremeVwap && currentPrice > vwap, 2); // Revert to VWAP

      // 5. RSI Divergence (Fast TF)
      check(rsi < 30 && roc > 0, rsi > 70 && roc < 0, 2);
      
      // 6. Volume Climax Reversal (Huge volume + small body = stop)
      const volSpike = volumes[volumes.length-1] > (volumes[volumes.length-2] || 0) * 2.5;
      check(volSpike && isSupport, volSpike && isResistance, 2);

      // 7. Standard Fast Momentum 
      check(cci < -100, cci > 100, 1);
      check(wr < -80, wr > -20, 1);
      check(macdData.histogram > 0, macdData.histogram < 0, 1);
      check(closes[closes.length-1] > opens[opens.length-1], closes[closes.length-1] < opens[opens.length-1], 1);
      
      // Reversal tagging
      if (Math.abs(buyPoints - sellPoints) >= 6) {
        isReversal = true;
      }
      
    } else {
      // 📈 MACRO TREND LOGIC (1m, 3m, 5m+)
      // Focus: Structure, EMAs, ADX Trend Strength, MACD Momentum.
      
      check(currentPrice > ema, currentPrice < ema);
      check(currentPrice > sma, currentPrice < sma);
      check(rsi > 50, rsi < 50);
      check(macdData.histogram > 0, macdData.histogram < 0);
      check(stochData.k > stochData.d, stochData.k < stochData.d);
      check(currentPrice > bb.middle, currentPrice < bb.middle);
      check(adxData.pdi > adxData.mdi, adxData.pdi < adxData.mdi);
      check(cci > 0, cci < 0);
      check(wr > -50, wr < -50);
      check(roc > 0, roc < 0);
      check(volumes[volumes.length-1] > volumes[volumes.length-2] && closes[closes.length-1] > opens[opens.length-1], volumes[volumes.length-1] > volumes[volumes.length-2] && closes[closes.length-1] < opens[opens.length-1]);
      check(currentPrice > vwap, currentPrice < vwap);
      check(currentPrice > psar, currentPrice < psar);
      check(currentPrice > ichi.spanA, currentPrice < ichi.spanB);
      check(currentPrice > fib0618, currentPrice < fib0382);
      check(isSupport, isResistance);
      check(isSuperTrendBullish, !isSuperTrendBullish);
      check(isHaBullish, !isHaBullish);

      // Binance Specific Reversals on Macro
      if (rsi < 25) reversalScore += 2;
      if (rsi > 75) reversalScore -= 2;
      if (lows[lows.length-1] < bb.lower && closes[closes.length-1] > bb.lower) reversalScore += 2;
      if (highs[highs.length-1] > bb.upper && closes[closes.length-1] < bb.upper) reversalScore -= 2;

      if (Math.abs(reversalScore) >= 3 && isBinance) {
        isReversal = true;
        if (reversalScore > 0) buyPoints += 3;
        if (reversalScore < 0) sellPoints += 3;
      }
    }

    const totalScore = buyPoints + sellPoints;
    let proba = totalScore > 0 ? Math.round((Math.max(buyPoints, sellPoints) / totalScore) * 100) : 50;
    
    // Determine Signal
    let signal: "BUY" | "SELL" | "WAIT" = "WAIT";
    let confidence: "HIGH" | "MEDIUM" | "LOW" = "LOW";

    if (proba >= 70) {
      signal = buyPoints > sellPoints ? "BUY" : "SELL";
      confidence = proba >= 85 ? "HIGH" : "MEDIUM";
    }

    const directionLabel = signal === "BUY" ? "CALL (HAUT)" : "PUT (BAS)";
    const strategyName = isMicroScalping ? "⚡ MICRO-REVERSAL ENGINE" : "🟢 MACRO TREND ENGINE";
    const revLabel = isReversal ? " [⚠️ DÉTECTION RETOURNEMENT IMMINENT]" : "";
    const reason = signal !== "WAIT" 
      ? `${strategyName} — ${directionLabel} | Prob: ${proba}% | Force: ${Math.max(buyPoints, sellPoints)} pts${revLabel}`
      : `🟡 WAIT — Marché indécis ou sans tendance claire (Prob: ${proba}%)`;

    return {
      signal,
      confidence,
      score: proba,
      reason,
      isReversal,
      metrics: { buyPoints, sellPoints, reversalScore }
    };
  }

  /**
   * Evaluate OTC Markets (PocketOption)
   * Focuses on Fakeouts, Trend Following, and avoiding manipulative spikes.
   */
  public static evaluateOtc(candles: Candle[], timeframe: Timeframe): SignalResult {
    if (candles.length < 20) {
      return { signal: "WAIT", confidence: "LOW", score: 0, reason: "Données insuffisantes (OTC)", isReversal: false, metrics: {} };
    }

    const closes = candles.map(c => c.close);
    const highs = candles.map(c => c.high);
    const lows = candles.map(c => c.low);
    const currentPrice = closes[closes.length - 1];

    // OTC requires simpler, trend-following momentum, less oscillation reliance
    const ema9 = EMA.calculate({ period: 9, values: closes }).pop() || currentPrice;
    const ema21 = EMA.calculate({ period: 21, values: closes }).pop() || currentPrice;
    const rsi = RSI.calculate({ period: 14, values: closes }).pop() || 50;
    
    const bbResult = BollingerBands.calculate({ period: 20, stdDev: 2, values: closes }).pop();
    const bbUpper = bbResult?.upper || currentPrice;
    const bbLower = bbResult?.lower || currentPrice;

    let buyScore = 0;
    let sellScore = 0;

    // Trend
    if (currentPrice > ema9) buyScore++; else sellScore++;
    if (ema9 > ema21) buyScore++; else sellScore++;
    
    // Momentum / Fakeout filter (OTC tends to ride the bands)
    if (currentPrice > bbUpper && rsi > 60) buyScore += 2; // OTC often pushes higher
    if (currentPrice < bbLower && rsi < 40) sellScore += 2; // OTC often pushes lower
    
    // Strict neutral zone rejection for OTC
    if (rsi > 45 && rsi < 55) {
      return { signal: "WAIT", confidence: "LOW", score: 0, reason: "🟡 OTC Choppy Zone (Fakeouts probables)", isReversal: false, metrics: {} };
    }

    const total = buyScore + sellScore;
    const proba = Math.round((Math.max(buyScore, sellScore) / (total || 1)) * 100);

    let signal: "BUY" | "SELL" | "WAIT" = "WAIT";
    if (proba >= 70) signal = buyScore > sellScore ? "BUY" : "SELL";

    return {
      signal,
      confidence: proba > 80 ? "HIGH" : "MEDIUM",
      score: proba,
      reason: signal !== "WAIT" ? `🔥 OTC ENGINE — ${signal} | Prob: ${proba}%` : "🟡 WAIT OTC",
      isReversal: false,
      metrics: { buyScore, sellScore }
    };
  }
}
