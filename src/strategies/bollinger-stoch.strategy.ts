import { BaseStrategy, StrategyResult } from './base-strategy';
import { Candle } from '../types/Candle';
import { calculateBollingerBands } from '../indicators/BollingerBands';
import { calculateStochasticOscillator } from '../indicators/Stochastic';
import { calculateRSIIndicator } from '../indicators/RSI';

export class BollingerStochStrategy extends BaseStrategy {
  calculateSignals(candles: Candle[]): StrategyResult {
    const closes = candles.map(c => c.close);
    
    const bb = calculateBollingerBands(closes);
    const stoch = calculateStochasticOscillator(candles);
    const rsi = calculateRSIIndicator(closes);

    let direction: "BUY" | "SELL" | "WAIT" = "WAIT";
    let confidence = 0;
    let reason = "";

    // Confluence Logic (Expert)
    let agreementCount = 0;
    const isBullish = bb.signal === "BUY" || stoch.signal === "BUY" || rsi.signal === "BUY";
    const isBearish = bb.signal === "SELL" || stoch.signal === "SELL" || rsi.signal === "SELL";

    if (isBullish) {
      if (bb.signal === "BUY") agreementCount++;
      if (stoch.signal === "BUY") agreementCount++;
      if (rsi.signal === "BUY") agreementCount++;
      if (rsi.value < 45) agreementCount++; // Pression acheteuse supplémentaire

      direction = "BUY";
      // Probabilité réelle: 40% (base) + 15% par accord
      confidence = Math.min(99, 40 + (agreementCount * 15));
      reason = `Confluence HAUSSIÈRE (${agreementCount} indicateurs) | RSI: ${rsi.value.toFixed(1)}`;
    } else if (isBearish) {
      if (bb.signal === "SELL") agreementCount++;
      if (stoch.signal === "SELL") agreementCount++;
      if (rsi.signal === "SELL") agreementCount++;
      if (rsi.value > 55) agreementCount++;

      direction = "SELL";
      confidence = Math.min(99, 40 + (agreementCount * 15));
      reason = `Confluence BAISSIÈRE (${agreementCount} indicateurs) | RSI: ${rsi.value.toFixed(1)}`;
    } else {
      direction = "WAIT";
      confidence = 40;
      reason = "Marché indécis (Pas de confluence)";
    }

    return {
      direction,
      confidence,
      reason,
      indicators: { bb, stoch, rsi }
    };
  }
}
