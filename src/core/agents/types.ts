export interface Candle {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  timestamp: number;
}

export interface IndicatorsState {
  ema9: number;
  ema21: number;
  ema50: number;
  rsi: number;
  macd: { MACD?: number; signal?: number; histogram?: number };
  stochastic: { k: number; d: number };
  bollinger: { upper: number; middle: number; lower: number; width: number };
  vwap: number;
}

export interface PriceActionState {
  isBullishPinbar: boolean;
  isBearishPinbar: boolean;
  isBullishEngulfing: boolean;
  isBearishEngulfing: boolean;
  isDoji: boolean;
}

export interface MarketStructureState {
  support: number | null;
  resistance: number | null;
  isNearSupport: boolean;
  isNearResistance: boolean;
  trend: "BULLISH" | "BEARISH" | "RANGE";
  trendStrength: number; // 0 to 100
  volatility: "HIGH" | "NORMAL" | "LOW";
}

export interface MarketState {
  timestamp: number;
  asset: string;
  timeframe: string;
  currentPrice: number;
  indicators: IndicatorsState;
  priceAction: PriceActionState;
  structure: MarketStructureState;
  newsBias?: {
    sentiment: "BULLISH" | "BEARISH" | "NEUTRAL";
    strength: number;
    reason: string;
  };
}

export interface ConfidenceResult {
  action: "BUY" | "SELL" | "WAIT";
  confidence: number; // 0 to 100
  strength: "weak" | "medium" | "strong";
  reasons: string[];
  marketQuality?: number; // 0-100, from Market Quality Score
}
