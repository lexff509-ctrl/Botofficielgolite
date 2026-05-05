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
    if (bb.signal === "BUY" && stoch.signal === "BUY") {
      direction = "BUY";
      confidence = rsi.value < 40 ? 95 : 85;
      reason = `Bandes de Bollinger (Bas) + Stochastique (Survente) + RSI (${rsi.value.toFixed(1)})`;
    } else if (bb.signal === "SELL" && stoch.signal === "SELL") {
      direction = "SELL";
      confidence = rsi.value > 60 ? 95 : 85;
      reason = `Bandes de Bollinger (Haut) + Stochastique (Surachat) + RSI (${rsi.value.toFixed(1)})`;
    } else if (bb.signal !== "NEUTRAL" || stoch.signal !== "NEUTRAL") {
      direction = bb.signal !== "NEUTRAL" ? (bb.signal as any) : (stoch.signal as any);
      confidence = 70;
      reason = bb.signal !== "NEUTRAL" ? "Signal Bandes de Bollinger" : "Signal Stochastique";
    }

    return {
      direction,
      confidence,
      reason,
      indicators: { bb, stoch, rsi }
    };
  }
}
