
import { PocketOptionClient } from '../lib/pocketoption/client';
import { signalEngine } from './SignalEngine';
import { candleBuffer } from './CandleBuffer';
import { Timeframe, Signal } from '../types/Signal';
import { Candle } from '../types/Candle';

export class WebSocketManager {
    private client: PocketOptionClient;
    private asset: string;
    private isMonitoring = false;
    private analysisIntervals: Map<string, NodeJS.Timeout> = new Map();

    constructor(ssid: string, asset: string) {
        this.asset = asset;
        this.client = new PocketOptionClient(ssid);
        this.setupListeners();
    }

    public connect() {
        this.client.connect(true); // Default to demo
    }

    private setupListeners() {
        this.client.onCandle(this.asset, (data) => {
            // Transform to our Candle type
            const candle: Candle = {
                timestamp: data.timestamp,
                open: data.open,
                high: data.high,
                low: data.low,
                close: data.close,
                volume: data.volume
            };
            
            // PocketOption typically sends 1m candles by default
            candleBuffer.updateCandles(this.asset, 60, [candle]);
        });
    }

    public analyzeNow(timeframe: Timeframe): Signal | null {
        const tfSec = this.tfToSeconds(timeframe);
        const candles = candleBuffer.getCandles(this.asset, tfSec);
        
        if (candles.length < 25) {
            console.log(`[WSManager] Data insufficient for ${timeframe} (${candles.length}/25)`);
            return null;
        }

        return signalEngine.generateSignal(this.asset, timeframe, candles);
    }

    private tfToSeconds(tf: Timeframe): number {
        const val = parseInt(tf);
        if (tf.endsWith('s')) return val;
        if (tf.endsWith('m')) return val * 60;
        return 60;
    }

    public start247Monitoring(timeframes: Timeframe[]) {
        if (this.isMonitoring) return;
        this.isMonitoring = true;

        timeframes.forEach(tf => {
            const ms = this.tfToSeconds(tf) * 1000;
            const interval = setInterval(() => {
                const signal = this.analyzeNow(tf);
                if (signal && signal.isValid) {
                    this.logSignal(signal);
                }
            }, ms);
            this.analysisIntervals.set(tf, interval);
        });
    }

    private logSignal(signal: Signal) {
        console.log(`[24/7] ${signal.timestamp} - ${signal.asset} ${signal.timeframe}: ${signal.direction} (${signal.confidence}%)`);
    }

    public stopMonitoring() {
        this.analysisIntervals.forEach(interval => clearInterval(interval));
        this.analysisIntervals.clear();
        this.isMonitoring = false;
    }
}
