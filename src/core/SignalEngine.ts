import { Candle } from '../types/Candle';
import { Signal, Timeframe } from '../types/Signal';
import { calculateBollingerBands } from '../indicators/BollingerBands';
import { calculateStochasticOscillator } from '../indicators/Stochastic';
import { calculateRSIIndicator } from '../indicators/RSI';
import { evaluateBollingerStochSignal } from '../lib/trading';

export class SignalEngine {
    private candleBuffer: Map<string, Candle[]> = new Map();
    private minCandles = 30;

    constructor() {}

    public generateSignal(asset: string, timeframe: Timeframe, candles: Candle[]): Signal | null {
        if (candles.length < this.minCandles) return null;

        const closes = candles.map(c => c.close);
        const lastPrice = closes[closes.length - 1];

        // 1. Calculate basic indicators for compatibility with the Signal interface
        const bb = calculateBollingerBands(closes);
        const stoch = calculateStochasticOscillator(candles);
        const rsi = calculateRSIIndicator(closes);

        // 2. Confluence Logic using the 20-indicator engine
        const advancedEval = evaluateBollingerStochSignal(candles);

        const direction = advancedEval.signal;
        const confidenceLabel = advancedEval.confidence;
        const diagnostic = advancedEval.reason;

        // Map confidence label to numerical score
        let confidence = 50;
        if (confidenceLabel === "HIGH") confidence = 95;
        else if (confidenceLabel === "MEDIUM") confidence = 75;
        else confidence = 55;

        // Re-adjust BB and Stoch signals based on advanced evaluation
        if (advancedEval.bollinger.signal !== "NEUTRAL") {
            bb.signal = advancedEval.bollinger.signal;
        }
        if (advancedEval.stochastic.signal !== "NEUTRAL") {
            stoch.signal = advancedEval.stochastic.signal as any;
        }

        const action = confidence >= 90 ? "ENTRER MAINTENANT" : confidence >= 70 ? "ATTENDRE" : "ÉVITER";

        return {
            id: `sig_${Date.now()}`,
            asset,
            direction,
            confidence,
            confidenceLabel,
            timeframe,
            timestamp: new Date().toISOString(),
            price: lastPrice,
            bollinger: bb,
            stochastic: stoch,
            rsi: rsi,
            signalScore: confidence / 100,
            diagnostic,
            action,
            isValid: direction !== "WAIT"
        };
    }
}

export const signalEngine = new SignalEngine();
