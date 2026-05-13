import { Candle } from '../types/Candle';
import { Signal, Timeframe } from '../types/Signal';
import { calculateBollingerBands } from '../indicators/BollingerBands';
import { calculateStochasticOscillator } from '../indicators/Stochastic';
import { calculateRSIIndicator } from '../indicators/RSI';
import { OrchestratorAgent } from './agents/OrchestratorAgent';

export class SignalEngine {
    private candleBuffer: Map<string, Candle[]> = new Map();
    private minCandles = 30;

    constructor() {}

    public async generateSignal(asset: string, timeframe: Timeframe, candles: Candle[]): Promise<Signal | null> {
        if (candles.length < this.minCandles) return null;

        const closes = candles.map(c => c.close);
        const lastPrice = closes[closes.length - 1];

        // 1. Calculate basic indicators for compatibility with the Signal interface
        const bb = calculateBollingerBands(closes);
        const stoch = calculateStochasticOscillator(candles);
        const rsi = calculateRSIIndicator(closes);

        // Determine if asset is OTC (PocketOption usually appends _OTC)
        const isOtc = asset.toUpperCase().includes("OTC");
        const isBinance = !isOtc; // Simplified: If not OTC, we treat it as Binance/External for the strict reversal rules

        // 2. Confluence Logic using the V5 OrchestratorAgent
        const advancedEval = await OrchestratorAgent.evaluate(candles, asset, timeframe, isOtc);

        const direction = advancedEval.signal === "BUY" ? "BUY" : advancedEval.signal === "SELL" ? "SELL" : "WAIT";
        const confidenceLabel = direction !== "WAIT" ? "HIGH" : "LOW";
        const diagnostic = advancedEval.reason;
        const confidence = advancedEval.confidence;

        // Re-adjust BB and Stoch signals based on advanced evaluation
        if (direction === "BUY") {
            bb.signal = "BUY";
            stoch.signal = "BUY" as any;
        } else if (direction === "SELL") {
            bb.signal = "SELL";
            stoch.signal = "SELL" as any;
        }

        const action = confidence >= 85 ? "ENTRER MAINTENANT" : confidence >= 70 ? "ATTENDRE" : "ÉVITER";

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
            isValid: true
        };
    }
}

export const signalEngine = new SignalEngine();
