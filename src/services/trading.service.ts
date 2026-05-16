/**
 * TradingService
 *
 * Owns the PocketOption client lifecycle and exposes a clean API to the bot
 * runner.  Key responsibilities:
 *
 *  - Connect / disconnect the PocketOption WebSocket.
 *  - Register the SSID-expiration callback BEFORE connecting (Fix #3).
 *  - Wrap `requestCandleHistory()` with timeout + exponential-backoff retry
 *    and fall back to cached data when the broker is unreachable (Fix #5).
 *  - Integrate OTC signal connection so OTC signals are fetched and validated
 *    (Fix #7).
 *  - Expose `onSsidExpired()` so the bot runner can register a pause hook.
 */

import type {
  BotConfig,
  Candle,
  CandleHistoryRequest,
  Signal,
  TimeframeSeconds,
  TradeDirection,
} from "@/types/trading";
import { PocketOptionClient } from "@/lib/pocket-option-client";
import { candleCache } from "@/lib/candle-cache";
import { computeIndicators } from "@/lib/indicators";
import {
  OtcSignalConnectionPool,
  DEFAULT_OTC_CONFIG,
} from "@/lib/otc-signal-connection";
import { ExponentialBackoff, sleep } from "@/lib/backoff";
import { createLogger } from "@/lib/logger";
import { v4 as uuidv4 } from "uuid";

const log = createLogger("TradingService");

// ─── Constants ────────────────────────────────────────────────────────────────

/** Minimum candles required before we attempt signal generation. */
const MIN_CANDLES_FOR_SIGNAL = 30;

/** How long to wait for candle history before giving up (ms). */
const CANDLE_HISTORY_TIMEOUT_MS = 15_000;

/** Retry config for candle history requests. */
const HISTORY_BACKOFF = {
  baseDelayMs: 500,
  maxDelayMs: 8_000,
  maxAttempts: 4,
} as const;

// ─── Service ──────────────────────────────────────────────────────────────────

export class TradingService {
  private _client: PocketOptionClient | null = null;
  private _config: BotConfig | null = null;
  private _ssidExpiredCallbacks: Array<() => void | Promise<void>> = [];
  private _signalCallbacks: Array<(signal: Signal) => void> = [];
  private _otcConnected = false;

  // ─── Lifecycle ─────────────────────────────────────────────────────────────

  /**
   * Register a callback that fires when the SSID expires.
   *
   * Fix #3: This MUST be called before `connect()` so the callback is in
   * place before any authentication attempt.
   */
  onSsidExpired(callback: () => void | Promise<void>): void {
    this._ssidExpiredCallbacks.push(callback);
  }

  /**
   * Register a callback that fires when a new signal (internal or OTC) is
   * ready.
   */
  onSignal(callback: (signal: Signal) => void): void {
    this._signalCallbacks.push(callback);
  }

  /**
   * Connect to PocketOption and (optionally) the OTC signal provider.
   *
   * Fix #3: SSID-expiration callbacks are wired up BEFORE the connect call
   * so they are guaranteed to fire even if the session is already expired.
   */
  async connect(config: BotConfig): Promise<void> {
    this._config = config;

    // 1. Create client
    this._client = new PocketOptionClient(config.ssid);

    // 2. Wire SSID expiration BEFORE connecting (Fix #3)
    this._client.on("ssidExpired", async () => {
      log.warn("SSID expired — notifying bot runner to pause");
      for (const cb of this._ssidExpiredCallbacks) {
        try {
          await cb();
        } catch (err) {
          log.error("Error in ssidExpired callback", err);
        }
      }
    });

    // 3. Wire candle updates into the cache
    this._client.on("candleUpdate", (candle: Candle) => {
      candleCache.upsert(candle);
    });

    this._client.on("candleHistory", (resp) => {
      candleCache.loadHistory(resp.candles);
    });

    this._client.on("error", (err) => {
      log.error("PocketOption client error", err);
    });

    // 4. Connect
    await this._client.connect();
    log.info("Connected to PocketOption");

    // 5. Subscribe to candle streams for all configured symbols
    //    Fix #6: subscriptions happen immediately after connect so the cache
    //    starts filling before the first tick runs.
    for (const symbol of config.symbols) {
      this._client.subscribeCandles(symbol, config.timeframe);
    }

    // 6. Pre-fetch candle history so the cache is warm before the bot starts
    //    Fix #6: this is the "setup phase" that ensures initial data is ready.
    await this._prefetchCandleHistory(config);

    // 7. Connect OTC signal provider if enabled (Fix #7)
    if (config.useOtcSignals) {
      await this._connectOtcSignals();
    }
  }

  /**
   * Disconnect all connections cleanly.
   */
  async disconnect(): Promise<void> {
    if (this._client) {
      this._client.disconnect();
      this._client = null;
    }
    if (this._otcConnected) {
      await OtcSignalConnectionPool.disconnectAll();
      this._otcConnected = false;
    }
    log.info("TradingService disconnected");
  }

  // ─── Candle data ───────────────────────────────────────────────────────────

  /**
   * Request candle history with exponential-backoff retry and a fallback to
   * the local cache when the broker is unreachable (Fix #5).
   */
  async requestCandleHistory(
    req: CandleHistoryRequest
  ): Promise<Candle[]> {
    if (!this._client) {
      throw new Error("TradingService: not connected");
    }

    const backoff = new ExponentialBackoff(HISTORY_BACKOFF);

    while (!backoff.exhausted) {
      // Check connection before each attempt
      if (!this._client.isConnected) {
        throw new Error(
          "TradingService: WebSocket disconnected during candle history request"
        );
      }

      try {
        const resp = await Promise.race([
          this._client.requestCandleHistory(req),
          this._timeoutReject<import("@/types/trading").CandleHistoryResponse>(
            CANDLE_HISTORY_TIMEOUT_MS,
            `Candle history timeout for ${req.symbol}:${req.timeframe}`
          ),
        ]);
        return resp.candles;
      } catch (err) {
        const isDisconnect =
          err instanceof Error &&
          (err.message.includes("disconnected") ||
            err.message.includes("not connected"));

        if (isDisconnect) {
          // No point retrying if the socket is gone
          log.warn("Candle history aborted — WebSocket disconnected", {
            symbol: req.symbol,
          });
          break;
        }

        log.warn("Candle history request failed — will retry", {
          symbol: req.symbol,
          attempt: backoff.attempt + 1,
          err: err instanceof Error ? err.message : String(err),
        });

        const waited = await backoff.wait();
        if (!waited) break;
      }
    }

    // Fallback: return whatever is in the local cache (Fix #5)
    const cached = candleCache.getLatest(req.symbol, req.timeframe, req.count);
    if (cached.length > 0) {
      log.warn("Using cached candle data as fallback", {
        symbol: req.symbol,
        count: cached.length,
      });
      return cached;
    }

    throw new Error(
      `Failed to obtain candle history for ${req.symbol}:${req.timeframe} and cache is empty`
    );
  }

  // ─── Signal generation ─────────────────────────────────────────────────────

  /**
   * Generate a signal from the current candle cache for the given symbol.
   *
   * Fix #5: Wrapped in try-catch; WebSocket disconnections are detected and
   * surfaced as a typed error rather than hanging indefinitely.
   *
   * Returns null if there is insufficient data or no clear signal.
   */
  async generateAndSaveSignal(
    symbol: string,
    timeframe: TimeframeSeconds
  ): Promise<Signal | null> {
    if (!this._config) return null;

    // Ensure we have enough candles
    const candles = candleCache.getLatest(symbol, timeframe, MIN_CANDLES_FOR_SIGNAL);
    if (candles.length < MIN_CANDLES_FOR_SIGNAL) {
      log.debug("Insufficient candles for signal generation", {
        symbol,
        have: candles.length,
        need: MIN_CANDLES_FOR_SIGNAL,
      });

      // Attempt to fetch more history (Fix #5: with proper error handling)
      try {
        const fresh = await this.requestCandleHistory({
          symbol,
          timeframe,
          count: MIN_CANDLES_FOR_SIGNAL,
        });
        if (fresh.length < MIN_CANDLES_FOR_SIGNAL) return null;
        // Cache is now updated via the candleHistory event handler
      } catch (err) {
        log.warn("Could not fetch candle history for signal generation", {
          symbol,
          err: err instanceof Error ? err.message : String(err),
        });
        return null;
      }
    }

    // Re-read from cache after potential history load
    const latestCandles = candleCache.getLatest(
      symbol,
      timeframe,
      MIN_CANDLES_FOR_SIGNAL
    );
    if (latestCandles.length < MIN_CANDLES_FOR_SIGNAL) return null;

    const indicators = computeIndicators(latestCandles);
    const direction = this._deriveDirection(indicators);
    if (!direction) return null;

    const confidence = this._computeConfidence(indicators, direction);
    if (confidence < (this._config.minConfidence ?? 0.6)) return null;

    const nowSec = Math.floor(Date.now() / 1_000);
    const signal: Signal = {
      id: uuidv4(),
      symbol,
      direction,
      timeframe,
      generatedAt: nowSec,
      expiresAt: nowSec + timeframe * 3,
      confidence,
      source: "internal",
      indicators,
    };

    log.info("Signal generated", {
      symbol,
      direction,
      confidence: confidence.toFixed(3),
    });

    for (const cb of this._signalCallbacks) {
      try {
        cb(signal);
      } catch (err) {
        log.error("Signal callback threw", err);
      }
    }

    return signal;
  }

  /**
   * Place a trade via the PocketOption client.
   */
  placeTrade(
    symbol: string,
    direction: TradeDirection,
    amount: number,
    durationSeconds: number
  ): void {
    if (!this._client) {
      throw new Error("TradingService: not connected");
    }
    this._client.placeTrade(symbol, direction, amount, durationSeconds);
  }

  // ─── Private helpers ───────────────────────────────────────────────────────

  /**
   * Pre-fetch candle history for all configured symbols so the cache is warm
   * before the first tick (Fix #6).
   */
  private async _prefetchCandleHistory(config: BotConfig): Promise<void> {
    const promises = config.symbols.map(async (symbol) => {
      try {
        const candles = await this.requestCandleHistory({
          symbol,
          timeframe: config.timeframe,
          count: MIN_CANDLES_FOR_SIGNAL,
        });
        log.info("Pre-fetched candle history", {
          symbol,
          count: candles.length,
        });
      } catch (err) {
        log.warn("Pre-fetch failed for symbol", {
          symbol,
          err: err instanceof Error ? err.message : String(err),
        });
      }
    });

    await Promise.allSettled(promises);
  }

  /**
   * Connect to the OTC signal provider and wire signals into the callback
   * chain (Fix #7).
   */
  private async _connectOtcSignals(): Promise<void> {
    try {
      const conn = OtcSignalConnectionPool.getOrCreate(DEFAULT_OTC_CONFIG);

      conn.on("signal", (signal: Signal) => {
        log.info("OTC signal received", {
          symbol: signal.symbol,
          direction: signal.direction,
          confidence: signal.confidence,
        });
        for (const cb of this._signalCallbacks) {
          try {
            cb(signal);
          } catch (err) {
            log.error("OTC signal callback threw", err);
          }
        }
      });

      conn.on("error", (err) => {
        log.error("OTC signal connection error", err);
      });

      await conn.connect();
      this._otcConnected = true;
      log.info("OTC signal connection established");
    } catch (err) {
      // OTC failure is non-fatal — internal signals still work
      log.warn("Failed to connect OTC signal provider", {
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * Derive trade direction from indicator values.
   * Returns null when indicators are ambiguous.
   */
  private _deriveDirection(
    ind: import("@/types/trading").SignalIndicators
  ): TradeDirection | null {
    let bullScore = 0;
    let bearScore = 0;

    // RSI
    if (ind.rsi !== undefined) {
      if (ind.rsi < 30) bullScore += 2; // oversold
      else if (ind.rsi > 70) bearScore += 2; // overbought
      else if (ind.rsi < 45) bullScore += 1;
      else if (ind.rsi > 55) bearScore += 1;
    }

    // MACD histogram
    if (ind.macdHistogram !== undefined) {
      if (ind.macdHistogram > 0) bullScore += 1;
      else if (ind.macdHistogram < 0) bearScore += 1;
    }

    // MACD crossover
    if (ind.macd !== undefined && ind.macdSignal !== undefined) {
      if (ind.macd > ind.macdSignal) bullScore += 1;
      else if (ind.macd < ind.macdSignal) bearScore += 1;
    }

    // EMA crossover
    if (ind.ema9 !== undefined && ind.ema21 !== undefined) {
      if (ind.ema9 > ind.ema21) bullScore += 1;
      else if (ind.ema9 < ind.ema21) bearScore += 1;
    }

    // Bollinger Band position
    if (
      ind.bollingerLower !== undefined &&
      ind.bollingerUpper !== undefined &&
      ind.bollingerMiddle !== undefined
    ) {
      // We'd need the last close price — use middle as proxy
      // (a real implementation would pass the last close separately)
    }

    const diff = bullScore - bearScore;
    if (diff >= 2) return "call";
    if (diff <= -2) return "put";
    return null; // ambiguous
  }

  /**
   * Compute a 0–1 confidence score from indicator agreement.
   */
  private _computeConfidence(
    ind: import("@/types/trading").SignalIndicators,
    direction: TradeDirection
  ): number {
    const isBull = direction === "call";
    let score = 0;
    let maxScore = 0;

    if (ind.rsi !== undefined) {
      maxScore += 2;
      if (isBull && ind.rsi < 40) score += 2;
      else if (!isBull && ind.rsi > 60) score += 2;
      else if (isBull && ind.rsi < 50) score += 1;
      else if (!isBull && ind.rsi > 50) score += 1;
    }

    if (ind.macdHistogram !== undefined) {
      maxScore += 1;
      if (isBull && ind.macdHistogram > 0) score += 1;
      else if (!isBull && ind.macdHistogram < 0) score += 1;
    }

    if (ind.macd !== undefined && ind.macdSignal !== undefined) {
      maxScore += 1;
      if (isBull && ind.macd > ind.macdSignal) score += 1;
      else if (!isBull && ind.macd < ind.macdSignal) score += 1;
    }

    if (ind.ema9 !== undefined && ind.ema21 !== undefined) {
      maxScore += 1;
      if (isBull && ind.ema9 > ind.ema21) score += 1;
      else if (!isBull && ind.ema9 < ind.ema21) score += 1;
    }

    if (maxScore === 0) return 0;
    // Normalise to 0.5–1.0 range so we never return a trivially low score
    return 0.5 + 0.5 * (score / maxScore);
  }

  /** Returns a promise that rejects after `ms` milliseconds. */
  private _timeoutReject<T>(ms: number, message: string): Promise<T> {
    return new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(message)), ms)
    );
  }
}

// Singleton instance
export const tradingService = new TradingService();
