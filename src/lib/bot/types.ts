export type BotStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "disconnected"
  | "error";

export interface BotConfig {
  /** Milliseconds to wait before the first reconnect attempt */
  reconnectBaseDelayMs: number;
  /** Maximum milliseconds between reconnect attempts (exponential back-off cap) */
  reconnectMaxDelayMs: number;
  /** Maximum number of consecutive reconnect attempts before giving up */
  maxReconnectAttempts: number;
  /** Milliseconds before a connection attempt is considered timed out */
  connectionTimeoutMs: number;
  /** Milliseconds between heartbeat pings */
  heartbeatIntervalMs: number;
  /** Milliseconds to wait for a pong before treating the connection as dead */
  heartbeatTimeoutMs: number;
}

export const DEFAULT_BOT_CONFIG: BotConfig = {
  reconnectBaseDelayMs: 1_000,
  reconnectMaxDelayMs: 30_000,
  maxReconnectAttempts: 10,
  connectionTimeoutMs: 15_000,
  heartbeatIntervalMs: 25_000,
  heartbeatTimeoutMs: 10_000,
};

export interface BotEvent {
  type: "status" | "message" | "error" | "signal";
  payload: unknown;
  timestamp: number;
}

export interface SignalPayload {
  asset: string;
  direction: "CALL" | "PUT";
  duration: number;
  confidence: number;
  source: "OTC" | "STANDARD";
  timestamp: number;
}
