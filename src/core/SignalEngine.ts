
import { Candle } from '../types/Candle';
import { Signal, Timeframe } from '../types/Signal';
import { calculateBollingerBands } from '../indicators/BollingerBands';
import { calculateStochasticOscillator } from '../indicators/Stochastic';
import { calculateRSIIndicator } from '../indicators/RSI';

export class SignalEngine {
    private candleBuffer: Map<string, Candle[]> = new Map();
    private minCandles = 30;

    constructor() {}

    public generateSignal(asset: string, timeframe: Timeframe, candles: Candle[]): Signal | null {
        if (candles.length < this.minCandles) return null;

        const closes = candles.map(c => c.close);
        const lastPrice = closes[closes.length - 1];

        // 1. Calculate Indicators
        const bb = calculateBollingerBands(closes);
        const stoch = calculateStochasticOscillator(candles);
        const rsi = calculateRSIIndicator(closes);

        // 2. Confluence Logic
        let direction: "BUY" | "SELL" | "WAIT" = "WAIT";
        let confidence = 0;
        let diagnostic = "";

        // BUY Setup: BB BUY + STOCH BUY
        if (bb.signal === "BUY" && stoch.signal === "BUY") {
            direction = "BUY";
            confidence = 95;
            diagnostic = "CONFLUENCE FORTE: Rebond BB Bas + Croisement Stoch Survente";
        } 
        // SELL Setup: BB SELL + STOCH SELL
        else if (bb.signal === "SELL" && stoch.signal === "SELL") {
            direction = "SELL";
            confidence = 95;
            diagnostic = "CONFLUENCE FORTE: Rebond BB Haut + Croisement Stoch Surachat";
        }
        // Medium Confidence
        else if (bb.signal === "BUY" || stoch.signal === "BUY") {
            direction = "BUY";
            confidence = 70;
            diagnostic = bb.signal === "BUY" ? "BB Rebond détecté" : "Stochastique Cross détecté";
        }
        else if (bb.signal === "SELL" || stoch.signal === "SELL") {
            direction = "SELL";
            confidence = 70;
            diagnostic = bb.signal === "SELL" ? "BB Rebond détecté" : "Stochastique Cross détecté";
        }

        const confidenceLabel = confidence >= 90 ? "HIGH" : confidence >= 60 ? "MEDIUM" : "LOW";
        const action = confidence >= 90 ? "ENTRER MAINTENANT" : confidence >= 60 ? "ATTENDRE" : "ÉVITER";

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
