import { Candle } from '../types/Candle';
import { Signal, Timeframe } from '../types/Signal';

export interface StrategyResult {
  direction: "BUY" | "SELL" | "WAIT";
  confidence: number;
  reason: string;
  indicators: any;
}

export abstract class BaseStrategy {
  constructor(
    protected symbol: string,
    protected timeframe: Timeframe,
    protected params: any
  ) {}

  abstract calculateSignals(candles: Candle[]): StrategyResult;
}
