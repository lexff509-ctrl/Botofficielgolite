
import { BollingerBands } from 'technicalindicators';
import { BollingerResult } from '../types/Signal';

export function calculateBollingerBands(closes: number[], period: number = 20, stdDev: number = 2): BollingerResult {
    if (closes.length < period) {
        const last = closes[closes.length - 1] || 0;
        return {
            signal: "WAIT",
            value: last,
            upper: last,
            middle: last,
            lower: last,
            bandwidth: 0,
            percentB: 0.5,
            price_position: "middle"
        };
    }

    const bb = BollingerBands.calculate({
        period,
        stdDev,
        values: closes
    });

    const lastBB = bb[bb.length - 1];
    const currentPrice = closes[closes.length - 1];
    const prevPrice = closes[closes.length - 2];
    
    const bandwidth = lastBB.upper - lastBB.lower;
    const percentB = bandwidth > 0 ? (currentPrice - lastBB.lower) / bandwidth : 0.5;

    let signal: "BUY" | "SELL" | "WAIT" = "WAIT";
    let price_position: "near_lower" | "near_upper" | "middle" = "middle";

    if (currentPrice <= lastBB.lower) {
        price_position = "near_lower";
        if (currentPrice > prevPrice) signal = "BUY";
    } else if (currentPrice >= lastBB.upper) {
        price_position = "near_upper";
        if (currentPrice < prevPrice) signal = "SELL";
    }

    return {
        signal,
        value: currentPrice,
        upper: lastBB.upper,
        middle: lastBB.middle,
        lower: lastBB.lower,
        bandwidth,
        percentB,
        price_position
    };
}
