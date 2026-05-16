/**
 * BotRunner
 *
 * Orchestrates the trading bot lifecycle.  All seven bugs from the issue are
 * addressed here and in the services it depends on:
 *
 *  Fix #1 — Re-entrancy: AsyncMutex prevents concurrent tick() executions.
 *  Fix #2 — Signal deadlock: force-signal timeout resets lastProcessedTimestamp
 *            when candles stop updating for > 2× the timeframe duration.
 *  Fix #3 — SSID expiration: onSsidExpired() is registered on TradingService
 *            BEFORE connect() is called; the callback pauses the runner.
 *  Fix #4 — Reconnection backoff: ExponentialBackoff (1 s base, 30 s max,
 *            15 attempts) with full jitter replaces the naive counter.
 *  Fix #5 — Signal generation errors: handled inside TradingService.
 *  Fix #6 — Candle cache init: subscriptions + history pre-fetch happen in
 *            TradingService.connect() before the tick loop starts.
 *  Fix #7 — OTC signals: OtcSignalConnection is managed by TradingService.
 */

import type { BotConfig, BotState, BotStatus, Signal, Trade } from "@/types/trading";
import { tradingService } from "@/services/trading.service";
import { candleCache } from "@/lib/candle-cache";
import { AsyncMutex } from "@/lib/async-mutex";
import { ExponentialBackoff, sleep } from "@/lib/backoff";
import { createLogger } from "@/lib/logger";
import { v4 as uuidv4 } from "uuid";

const log = createLogger("BotRunner");

// ─── Constants ────────────────────────────────────────────────────────────────

/** How often the main tick loop fires (ms). */
const TICK_INTERVAL_MS = 1_000;

/**
 * Fix #2: If lastProcessedTimestamp hasn't advanced for this many multiples of
 * the timeframe, reset it so signal generation can proceed.
 */
const STALE_TIMESTAMP_MULTIPLIER = 2;

/** Minimum candles in cache before we attempt signal generation. */
const MIN_CANDLES_READY = 30;

/** Cooldown between trades on the same symbol (ms). */
const DEFAULT_TRADE_COOLDOWN_MS = 60_000;

// ─── BotRunner ────────────────────────────────────────────────────────────────

export class BotRunner {
  // ── State ──────────────────────────────────────────────────────────────────
  private _status: BotStatus = "idle";
  private _config: BotConfig | null = null;
  private _activeTrades: Map<string, Trade> = new Map();
  private _recentSignals: Signal[] = [];
  private _lastTickAt: number | null = null;
  private _errorMessage: string | null = null;
  private _sessionValid = false;

  // ── Fix #1: Mutex for tick re-entrancy prevention ─────────────────────────
  private readonly _tickMutex = new AsyncMutex();

  // ── Fix #4: Exponential backoff for reconnection ──────────────────────────
  private readonly _reconnectBackoff = new ExponentialBackoff({
    baseDelayMs: 1_000,
    maxDelayMs: 30_000,
    maxAttempts: 15,
  });

  // ── Fix #2: Per-symbol last-processed timestamp tracking ──────────────────
  /**
   * Maps `${symbol}:${timeframe}` → last candle timestamp we processed.
   * Reset when the stale-timestamp safety valve fires.
   */
  private _lastProcessedTimestamp: Map<string, number> = new Map();

  /** Tracks when each symbol's cooldown expires (ms epoch). */
  private _cooldownUntil: Map<string, number> = new Map();

  // ── Reconnection state machine ─────────────────────────────────────────────
  private _isReconnecting = false;

  // ── Tick loop handle ───────────────────────────────────────────────────────
  private _tickTimer: ReturnType<typeof setInterval> | null = null;

  // ── State-change listeners ─────────────────────────────────────────────────
  private _stateListeners: Array<(state: BotState) => void> = [];

  // ─── Public API ────────────────────────────────────────────────────────────

  /** Subscribe to state changes. Returns an unsubscribe function. */
  onStateChange(listener: (state: BotState) => void): () => void {
    this._stateListeners.push(listener);
    // Deliver current state immediately
    listener(this.getState());
    return () => {
      this._stateListeners = this._stateListeners.filter((l) => l !== listener);
    };
  }

  getState(): BotState {
    return {
      status: this._status,
      config: this._config,
      activeTrades: [...this._activeTrades.values()],
      recentSignals: [...this._recentSignals].slice(-50),
      lastTickAt: this._lastTickAt,
      reconnectAttempts: this._reconnectBackoff.attempt,
      errorMessage: this._errorMessage,
      sessionValid: this._sessionValid,
    };
  }

  /**
   * Start the bot.
   *
   * Fix #3: SSID expiration callback is registered on TradingService BEFORE
   * connect() is called.
   * Fix #6: Candle cache is populated during connect() before the tick loop
   * starts.
   */
  async start(config: BotConfig): Promise<void> {
    if (this._status !== "idle" && this._status !== "stopped") {
      log.warn("start() called while bot is not idle/stopped", {
        status: this._status,
      });
      return;
    }

    this._config = config;
    this._setStatus("connecting");
    this._reconnectBackoff.reset();
    this._lastProcessedTimestamp.clear();
    this._cooldownUntil.clear();

    // Fix #3: Register SSID expiration handler BEFORE connecting
    tradingService.onSsidExpired(async () => {
      log.warn("SSID expired — pausing bot runner");
      this._sessionValid = false;
      try {
        await this.pause("SSID expired");
      } catch (err) {
        log.error("Error pausing bot after SSID expiration", err);
      }
    });

    // Wire OTC + internal signals into the runner
    tradingService.onSignal((signal) => this._handleIncomingSignal(signal));

    try {
      // Fix #6: connect() pre-fetches candle history before returning
      await tradingService.connect(config);
      this._sessionValid = true;
      this._setStatus("running");
      log.info("Bot started", { symbols: config.symbols, timeframe: config.timeframe });
      this._startTickLoop();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error("Failed to start bot", { err: msg });
      this._setStatus("error");
      this._errorMessage = msg;
      this._notifyListeners();
    }
  }

  /**
   * Pause the bot (keeps the connection alive but stops trading).
   */
  async pause(reason = "manual"): Promise<void> {
    if (this._status === "paused") return;
    log.info("Pausing bot", { reason });
    this._stopTickLoop();
    this._setStatus("paused");
  }

  /**
   * Resume from paused state.
   */
  async resume(): Promise<void> {
    if (this._status !== "paused") {
      log.warn("resume() called but bot is not paused", { status: this._status });
      return;
    }
    log.info("Resuming bot");
    this._setStatus("running");
    this._startTickLoop();
  }

  /**
   * Stop the bot completely and disconnect.
   */
  async stop(): Promise<void> {
    log.info("Stopping bot");
    this._stopTickLoop();
    await tradingService.disconnect();
    this._setStatus("stopped");
    this._sessionValid = false;
    this._activeTrades.clear();
    this._lastProcessedTimestamp.clear();
    this._cooldownUntil.clear();
    this._notifyListeners();
  }

  // ─── Tick loop ─────────────────────────────────────────────────────────────

  private _startTickLoop(): void {
    if (this._tickTimer) return; // already running
    this._tickTimer = setInterval(() => {
      // Fire-and-forget; errors are caught inside tick()
      this._tick().catch((err) => {
        log.error("Unhandled error in tick()", err);
      });
    }, TICK_INTERVAL_MS);
  }

  private _stopTickLoop(): void {
    if (this._tickTimer) {
      clearInterval(this._tickTimer);
      this._tickTimer = null;
    }
  }

  /**
   * Main tick — runs every TICK_INTERVAL_MS.
   *
   * Fix #1: The AsyncMutex ensures only one tick runs at a time.  If a tick
   * is already in progress when the interval fires, `tryAcquire()` returns
   * null and the tick is skipped entirely (no queuing, no re-entrancy).
   */
  private async _tick(): Promise<void> {
    if (this._status !== "running") return;

    // Fix #1: Non-blocking mutex try — skip this tick if one is already running
    const release = this._tickMutex.tryAcquire();
    if (!release) {
      log.debug("Tick skipped — previous tick still running");
      return;
    }

    try {
      this._lastTickAt = Date.now();
      await this._processTick();
    } catch (err) {
      log.error("Error during tick", err);
      // If the error looks like a disconnection, trigger reconnect
      const msg = err instanceof Error ? err.message : String(err);
      if (
        msg.includes("disconnected") ||
        msg.includes("not connected") ||
        msg.includes("WebSocket")
      ) {
        await this._handleDisconnect(msg);
      }
    } finally {
      release();
      this._notifyListeners();
    }
  }

  /**
   * Core tick logic — iterates over configured symbols and attempts signal
   * generation + trade placement.
   */
  private async _processTick(): Promise<void> {
    if (!this._config) return;

    const { symbols, timeframe, maxConcurrentTrades } = this._config;

    // Respect max concurrent trades
    if (this._activeTrades.size >= maxConcurrentTrades) {
      log.debug("Max concurrent trades reached — skipping tick", {
        active: this._activeTrades.size,
        max: maxConcurrentTrades,
      });
      return;
    }

    for (const symbol of symbols) {
      if (this._status !== "running") break;

      // Per-symbol cooldown check (Fix #1 corollary: use proper timing)
      const cooldown = this._cooldownUntil.get(symbol) ?? 0;
      if (Date.now() < cooldown) {
        log.debug("Symbol in cooldown", {
          symbol,
          remainingMs: cooldown - Date.now(),
        });
        continue;
      }

      // Fix #2: Check for stale lastProcessedTimestamp
      await this._maybeResetStaleTimestamp(symbol, timeframe);

      // Check if the cache has fresh data
      const latestTs = candleCache.latestTimestamp(symbol, timeframe);
      if (latestTs === null) {
        log.debug("No candle data yet for symbol", { symbol });
        continue;
      }

      const seriesKey = `${symbol}:${timeframe}`;
      const lastProcessed = this._lastProcessedTimestamp.get(seriesKey);

      // Only process if there is a new candle since last tick
      if (lastProcessed !== undefined && latestTs <= lastProcessed) {
        log.debug("No new candle since last tick", { symbol, latestTs });
        continue;
      }

      // Ensure we have enough candles
      if (!candleCache.isReady(symbol, timeframe, MIN_CANDLES_READY)) {
        log.debug("Cache not ready yet", { symbol });
        continue;
      }

      // Generate signal
      const signal = await tradingService.generateAndSaveSignal(symbol, timeframe);

      if (signal) {
        this._lastProcessedTimestamp.set(seriesKey, latestTs);
        await this._handleSignalForTrade(signal);
      } else {
        // Still update the timestamp so we don't re-process the same candle
        this._lastProcessedTimestamp.set(seriesKey, latestTs);
      }
    }
  }

  /**
   * Fix #2: If the lastProcessedTimestamp for a symbol hasn't changed for
   * more than 2× the timeframe duration, reset it.  This prevents the bot
   * from hanging silently when candles stop updating.
   */
  private async _maybeResetStaleTimestamp(
    symbol: string,
    timeframe: number
  ): Promise<void> {
    const seriesKey = `${symbol}:${timeframe}`;
    const lastProcessed = this._lastProcessedTimestamp.get(seriesKey);
    if (lastProcessed === undefined) return;

    const staleThresholdMs = timeframe * STALE_TIMESTAMP_MULTIPLIER * 1_000;
    const nowMs = Date.now();
    const lastProcessedMs = lastProcessed * 1_000;

    if (nowMs - lastProcessedMs > staleThresholdMs) {
      log.warn(
        "Fix #2: lastProcessedTimestamp is stale — resetting to allow signal generation",
        {
          symbol,
          timeframe,
          staleForMs: nowMs - lastProcessedMs,
          thresholdMs: staleThresholdMs,
        }
      );
      this._lastProcessedTimestamp.delete(seriesKey);
    }
  }

  // ─── Signal handling ───────────────────────────────────────────────────────

  /**
   * Handle a signal that arrived from either the internal engine or the OTC
   * provider (Fix #7).
   */
  private _handleIncomingSignal(signal: Signal): void {
    // Deduplicate: ignore if we already have this signal
    if (this._recentSignals.some((s) => s.id === signal.id)) return;

    this._recentSignals.push(signal);
    // Keep the list bounded
    if (this._recentSignals.length > 200) {
      this._recentSignals.splice(0, this._recentSignals.length - 200);
    }

    log.info("Signal received", {
      source: signal.source,
      symbol: signal.symbol,
      direction: signal.direction,
      confidence: signal.confidence.toFixed(3),
    });

    this._notifyListeners();
  }

  /**
   * Decide whether to place a trade based on a signal.
   */
  private async _handleSignalForTrade(signal: Signal): Promise<void> {
    if (!this._config) return;
    if (this._status !== "running") return;

    const { minConfidence, tradeAmount, timeframe, maxConcurrentTrades } =
      this._config;

    if (signal.confidence < minConfidence) {
      log.debug("Signal confidence below threshold", {
        symbol: signal.symbol,
        confidence: signal.confidence,
        threshold: minConfidence,
      });
      return;
    }

    if (this._activeTrades.size >= maxConcurrentTrades) {
      log.debug("Max concurrent trades reached — not placing trade");
      return;
    }

    // Check signal expiry
    const nowSec = Math.floor(Date.now() / 1_000);
    if (signal.expiresAt <= nowSec) {
      log.debug("Signal expired — not placing trade", { symbol: signal.symbol });
      return;
    }

    try {
      const tradeId = uuidv4();
      const trade: Trade = {
        id: tradeId,
        signalId: signal.id,
        symbol: signal.symbol,
        direction: signal.direction,
        amount: tradeAmount,
        openTime: nowSec,
        closeTime: nowSec + timeframe,
        openPrice: 0, // filled by broker response
        status: "pending",
      };

      this._activeTrades.set(tradeId, trade);

      tradingService.placeTrade(
        signal.symbol,
        signal.direction,
        tradeAmount,
        timeframe
      );

      // Set cooldown for this symbol
      const cooldownMs =
        (this._config.tradeCooldownSeconds ?? DEFAULT_TRADE_COOLDOWN_MS / 1_000) *
        1_000;
      this._cooldownUntil.set(signal.symbol, Date.now() + cooldownMs);

      log.info("Trade placed", {
        tradeId,
        symbol: signal.symbol,
        direction: signal.direction,
        amount: tradeAmount,
      });
    } catch (err) {
      log.error("Failed to place trade", {
        symbol: signal.symbol,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // ─── Reconnection ──────────────────────────────────────────────────────────

  /**
   * Handle a disconnection event.
   *
   * Fix #4: Uses ExponentialBackoff (1 s base, 30 s max, 15 attempts, full
   * jitter) instead of a naive counter.
   * Fix #1 corollary: Guards against concurrent reconnection attempts with
   * the `_isReconnecting` flag.
   */
  private async _handleDisconnect(reason: string): Promise<void> {
    // Fix #1: Prevent concurrent reconnection attempts
    if (this._isReconnecting) {
      log.debug("Reconnection already in progress — skipping");
      return;
    }

    if (this._status === "stopped" || this._status === "paused") {
      log.debug("Not reconnecting — bot is stopped/paused");
      return;
    }

    this._isReconnecting = true;
    this._stopTickLoop();
    this._setStatus("reconnecting");
    log.warn("Disconnected — starting reconnection sequence", { reason });

    try {
      while (!this._reconnectBackoff.exhausted) {
        const delay = this._reconnectBackoff.nextDelayMs();
        if (delay === null) break;

        log.info(
          `Reconnect attempt ${this._reconnectBackoff.attempt}/${this._reconnectBackoff.maxAttempts} in ${delay}ms`
        );
        await sleep(delay);

        if (this._status === "stopped" || this._status === "paused") {
          log.info("Reconnection cancelled — bot stopped/paused during backoff");
          return;
        }

        try {
          await tradingService.connect(this._config!);
          this._sessionValid = true;
          this._reconnectBackoff.reset();
          this._setStatus("running");
          this._startTickLoop();
          log.info("Reconnected successfully");
          return;
        } catch (err) {
          log.warn("Reconnection attempt failed", {
            attempt: this._reconnectBackoff.attempt,
            err: err instanceof Error ? err.message : String(err),
          });
        }
      }

      // All attempts exhausted
      log.error("Max reconnection attempts reached — bot entering error state");
      this._setStatus("error");
      this._errorMessage = `Reconnection failed after ${this._reconnectBackoff.maxAttempts} attempts`;
    } finally {
      this._isReconnecting = false;
      this._notifyListeners();
    }
  }

  // ─── State helpers ─────────────────────────────────────────────────────────

  private _setStatus(status: BotStatus): void {
    if (this._status === status) return;
    log.info(`Status: ${this._status} → ${status}`);
    this._status = status;
    if (status !== "error") this._errorMessage = null;
  }

  private _notifyListeners(): void {
    const state = this.getState();
    for (const listener of this._stateListeners) {
      try {
        listener(state);
      } catch (err) {
        log.error("State listener threw", err);
      }
    }
  }
}

// Singleton instance
export const botRunner = new BotRunner();
