
export type Direction = "BUY" | "SELL" | "WAIT";
export type ConfidenceLabel = "HIGH" | "MEDIUM" | "LOW";
export type Timeframe = "5s" | "10s" | "15s" | "30s" | "1m";
export type Zone = "oversold" | "overbought" | "neutral";

export interface IndicatorResult {
    signal: Direction;
    value: number | number[];
    zone?: Zone;
    crossover?: boolean;
}

export interface BollingerResult extends IndicatorResult {
    upper: number;
    middle: number;
    lower: number;
    bandwidth: number;
    percentB: number;
    price_position: "near_lower" | "near_upper" | "middle" | string;
}

export interface StochasticResult extends IndicatorResult {
    k: number;
    d: number;
    zone: Zone;
    crossover: boolean;
}

export interface RSIResult extends IndicatorResult {
    value: number;
    zone: Zone;
}

export interface Signal {
    id: string;
    asset: string;
    direction: Direction;
    confidence: number;
    confidenceLabel: ConfidenceLabel;
    timeframe: Timeframe;
    timestamp: string;
    price: number;
    bollinger: BollingerResult;
    stochastic: StochasticResult;
    rsi: RSIResult;
    signalScore: number;
    diagnostic: string;
    action: string;
    isValid: boolean;
}
