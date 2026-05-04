
import { Stochastic } from 'technicalindicators';
import { StochasticResult } from '../types/Signal';
import { Candle } from '../types/Candle';

export function calculateStochasticOscillator(candles: Candle[], period: number = 14, signalPeriod: number = 3): StochasticResult {
    if (candles.length < period + signalPeriod) {
        return {
            signal: "WAIT",
            value: [50, 50],
            k: 50,
            d: 50,
            zone: "neutral",
            crossover: false
        };
    }

    const input = {
        high: candles.map(c => c.high),
        low: candles.map(c => c.low),
        close: candles.map(c => c.close),
        period,
        signalPeriod
    };

    const results = Stochastic.calculate(input);
    const last = results[results.length - 1];
    const prev = results[results.length - 2];

    let signal: "BUY" | "SELL" | "WAIT" = "WAIT";
    let zone: "oversold" | "overbought" | "neutral" = "neutral";
    let crossover = false;

    if (last.k < 20) zone = "oversold";
    else if (last.k > 80) zone = "overbought";

    // Crossover logic
    if (prev.k <= prev.d && last.k > last.d) {
        crossover = true;
        if (zone === "oversold") signal = "BUY";
    } else if (prev.k >= prev.d && last.k < last.d) {
        crossover = true;
        if (zone === "overbought") signal = "SELL";
    }

    return {
        signal,
        value: [last.k, last.d],
        k: last.k,
        d: last.d,
        zone,
        crossover
    };
}
