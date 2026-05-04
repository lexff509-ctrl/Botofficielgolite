
import { Candle } from '../types/Candle';
import { Timeframe } from '../types/Signal';

export class CandleBuffer {
    private buffer: Map<string, Candle[]> = new Map();
    private currentTicks: Map<string, number[]> = new Map();
    private maxCandles = 100;

    constructor() {}

    public addTick(asset: string, price: number, timeframeSec: number) {
        const key = `${asset}:${timeframeSec}`;
        if (!this.currentTicks.has(key)) this.currentTicks.set(key, []);
        this.currentTicks.get(key)!.push(price);

        // Logic for closing candle based on timeframe could be added here
        // or handled by the external loop
    }

    public updateCandles(asset: string, timeframeSec: number, newCandles: Candle[]) {
        const key = `${asset}:${timeframeSec}`;
        let current = this.buffer.get(key) || [];
        
        // Simple merge/deduplicate logic
        const existingTimestamps = new Set(current.map(c => c.timestamp));
        for (const candle of newCandles) {
            if (!existingTimestamps.has(candle.timestamp)) {
                current.push(candle);
            }
        }

        current.sort((a, b) => a.timestamp - b.timestamp);
        if (current.length > this.maxCandles) current = current.slice(-this.maxCandles);
        
        this.buffer.set(key, current);
    }

    public getCandles(asset: string, timeframeSec: number): Candle[] {
        return this.buffer.get(`${asset}:${timeframeSec}`) || [];
    }
}

export const candleBuffer = new CandleBuffer();
