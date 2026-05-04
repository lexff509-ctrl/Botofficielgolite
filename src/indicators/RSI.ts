
import { RSI } from 'technicalindicators';
import { RSIResult } from '../types/Signal';

export function calculateRSIIndicator(closes: number[], period: number = 14): RSIResult {
    if (closes.length < period + 1) {
        return {
            signal: "WAIT",
            value: 50,
            zone: "neutral"
        };
    }

    const results = RSI.calculate({ values: closes, period });
    const last = results[results.length - 1];

    let zone: "oversold" | "overbought" | "neutral" = "neutral";
    let signal: "BUY" | "SELL" | "WAIT" = "WAIT";

    if (last < 30) {
        zone = "oversold";
        signal = "BUY";
    } else if (last > 70) {
        zone = "overbought";
        signal = "SELL";
    }

    return {
        signal,
        value: last,
        zone
    };
}
