// ─── Core domain types ────────────────────────────────────────────────────────

export type TradeDirection = "call" | "put";
export type AssetType = "forex" | "crypto" | "otc" | "stock" | "commodity";
export type TimeframeSeconds = 5 | 10 | 15 | 30 | 60 | 120 | 300;

export interface Asset {
  id: string;
  symbol: string;
  name: string;
  type: AssetType;
  /** Payout percentage (0–100) */
  payout: number;
  isOpen: boolean;
}

export interface Candle {
  /** Unix timestamp in seconds (open time) */
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  /** Timeframe in seconds */
  timeframe: TimeframeSeconds;
  symbol: string;
}

export interface Signal {
  id: string;
  symbol: string;
  direction: TradeDirection;
  timeframe: TimeframeSeconds;
  /** Unix timestamp (seconds) when the signal was generated */
  generatedAt: number;
  /** Unix timestamp (seconds) when the signal expires */
  expiresAt: number;
  /** Confidence score 0–1 */
  confidence: number;
  source: "internal" | "otc";
  /** Raw indicator values used to produce this signal */
  indicators: SignalIndicators;
}

export interface SignalIndicators {
  rsi?: number;
  macd?: number;
  macdSignal?: number;
  macdHistogram?: number;
  ema9?: number;
  ema21?: number;
  bollingerUpper?: number;
  bollingerMiddle?: number;
  bollingerLower?: number;
  atr?: number;
}

export interface Trade {
  id: string;
  signalId: string;
  symbol: string;
  direction: TradeDirection;
  amount: number;
  openTime: number;
  closeTime: number;
  openPrice: number;
  closePrice?: number;
  profit?: number;
  status: "pending" | "open" | "won" | "lost" | "cancelled";
}

// ─── Bot configuration ────────────────────────────────────────────────────────

export interface BotConfig {
  ssid: string;
  /** Trade amount in account currency */
  tradeAmount: number;
  /** Timeframe to trade on */
  timeframe: TimeframeSeconds;
  /** Symbols to watch */
  symbols: string[];
  /** Minimum confidence required to place a trade (0–1) */
  minConfidence: number;
  /** Maximum concurrent open trades */
  maxConcurrentTrades: number;
  /** Whether to use OTC signals */
  useOtcSignals: boolean;
  /** Whether to use internal signals */
  useInternalSignals: boolean;
  /** Cooldown between trades on the same symbol (seconds) */
  tradeCooldownSeconds: number;
}

// ─── Bot runner state ─────────────────────────────────────────────────────────

export type BotStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "running"
  | "paused"
  | "reconnecting"
  | "error"
  | "stopped";

export interface BotState {
  status: BotStatus;
  config: BotConfig | null;
  activeTrades: Trade[];
  recentSignals: Signal[];
  lastTickAt: number | null;
  reconnectAttempts: number;
  errorMessage: string | null;
  sessionValid: boolean;
}

// ─── WebSocket / PocketOption protocol ───────────────────────────────────────

export interface CandleHistoryRequest {
  symbol: string;
  timeframe: TimeframeSeconds;
  count: number;
}

export interface CandleHistoryResponse {
  symbol: string;
  timeframe: TimeframeSeconds;
  candles: Candle[];
}

export interface PocketOptionMessage {
  type: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload: any;
}

// ─── OTC signal protocol ──────────────────────────────────────────────────────

export interface OtcSignalRaw {
  id: string;
  asset: string;
  direction: "call" | "put";
  timeframe: number;
  timestamp: number;
  confidence: number;
}

export interface OtcConnectionConfig {
  endpoint: string;
  apiKey?: string;
  reconnectBaseDelayMs: number;
  reconnectMaxDelayMs: number;
  reconnectMaxAttempts: number;
  signalTtlSeconds: number;
}
