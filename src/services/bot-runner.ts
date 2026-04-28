// BotRunner - Background trading loop per user
// Signal mode: generates signals from real candle data
// Auto mode: generates signals + executes trades when confidence >= threshold

import { db } from "@/db";
import { botSessions, signals, trades, users } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import {
  generateSignal,
  type Timeframe,
  type Signal,
  type Candle,
  TIMEFRAMES,
} from "@/lib/trading";
import { candleCache } from "@/lib/candle-cache";
import { getPocketOptionClient, executeTrade } from "@/services/trading.service";
import { hasActiveSubscription } from "@/services/payment.service";

// ============ CONFIG ============

const AUTO_TRADE_CONFIDENCE_THRESHOLD = 70; // Minimum confidence % to auto-trade (standard mode)
const HIGH_CONFIDENCE_THRESHOLD = 80; // Minimum confidence % for high confidence mode
const MAX_CONSECUTIVE_ERRORS = 10;

function getLoopIntervalMs(timeframe: string): number {
  if (timeframe.endsWith("s")) return parseInt(timeframe) * 1000;
  if (timeframe === "1m") return 30_000;
  if (timeframe === "3m") return 60_000;
  if (timeframe === "5m") return 60_000;
  return 30_000;
}

// ============ BOT RUNNER CLASS ============

export class BotRunner {
  readonly userId: number;
  readonly botType: "signal" | "auto";
  readonly asset: string;
  readonly timeframe: Timeframe;
  readonly mode: "DEMO" | "LIVE";
  readonly tradeAmount: number;
  readonly confidenceMode: "standard" | "high";

  private intervalHandle: ReturnType<typeof setInterval> | null = null;
  private consecutiveErrors = 0;
  private isPaused = false;
  private pauseReason: string | null = null;
  private lastSignalAt: number | null = null;
  private signalsGenerated = 0;
  private tradesExecuted = 0;
  private startedAt: Date;
  private stopped = false;

  constructor(opts: {
    userId: number;
    botType: "signal" | "auto";
    asset: string;
    timeframe: Timeframe;
    mode: "DEMO" | "LIVE";
    tradeAmount?: number;
    confidenceMode?: "standard" | "high";
  }) {
    this.userId = opts.userId;
    this.botType = opts.botType;
    this.asset = opts.asset;
    this.timeframe = opts.timeframe;
    this.mode = opts.mode;
    this.tradeAmount = opts.tradeAmount || 1;
    this.confidenceMode = opts.confidenceMode || "standard";
    this.startedAt = new Date();
  }

  get running(): boolean {
    return this.intervalHandle !== null && !this.stopped;
  }

  get paused(): boolean {
    return this.isPaused;
  }

  getStatus(): {
    userId: number;
    botType: "signal" | "auto";
    asset: string;
    timeframe: Timeframe;
    mode: "DEMO" | "LIVE";
    tradeAmount: number;
    confidenceMode: "standard" | "high";
    running: boolean;
    paused: boolean;
    pauseReason: string | null;
    signalsGenerated: number;
    tradesExecuted: number;
    consecutiveErrors: number;
    lastSignalAt: number | null;
    startedAt: Date;
  } {
    return {
      userId: this.userId,
      botType: this.botType,
      asset: this.asset,
      timeframe: this.timeframe,
      mode: this.mode,
      tradeAmount: this.tradeAmount,
      confidenceMode: this.confidenceMode,
      running: this.running,
      paused: this.isPaused,
      pauseReason: this.pauseReason,
      signalsGenerated: this.signalsGenerated,
      tradesExecuted: this.tradesExecuted,
      consecutiveErrors: this.consecutiveErrors,
      lastSignalAt: this.lastSignalAt,
      startedAt: this.startedAt,
    };
  }

  start(): void {
    if (this.intervalHandle) return;

    // Subscribe to candle data via cache
    const sizeSeconds = this.timeframeToSeconds();
    candleCache.subscribe(this.asset, sizeSeconds);

    // If cache is empty, request historical candles to bootstrap
    this.bootstrapCandles();

    const intervalMs = getLoopIntervalMs(this.timeframe);
    this.intervalHandle = setInterval(() => {
      this.tick().catch(() => {
        this.consecutiveErrors++;
        if (this.consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
          this.pause("Trop d'erreurs consécutives");
        }
      });
    }, intervalMs);

    // Run first tick immediately
    this.tick().catch(() => {});
  }

  stop(): void {
    this.stopped = true;
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
    // Unsubscribe from candle cache
    const sizeSeconds = this.timeframeToSeconds();
    candleCache.unsubscribe(this.asset, sizeSeconds);
  }

  pause(reason: string): void {
    this.isPaused = true;
    this.pauseReason = reason;
    console.warn(
      `[BotRunner] Paused for user ${this.userId}: ${reason}`
    );
  }

  resume(): void {
    this.isPaused = false;
    this.pauseReason = null;
    this.consecutiveErrors = 0;
  }

  // ============ PRIVATE ============

  private timeframeToSeconds(): number {
    const tf = this.timeframe;
    if (tf.endsWith("s")) return parseInt(tf);
    if (tf.endsWith("m")) return parseInt(tf) * 60;
    return 60;
  }

  private async bootstrapCandles(): Promise<void> {
    const client = getPocketOptionClient(this.userId);
    if (client && client.isConnected) {
      try {
        const sizeSeconds = this.timeframeToSeconds();
        const historicalCandles = await client.requestCandleHistory(
          this.asset,
          sizeSeconds,
          200
        );
        if (historicalCandles.length > 0) {
          candleCache.seedCandles(this.asset, sizeSeconds, historicalCandles);
        }
      } catch {
        // Historical bootstrap failed, will rely on real-time data
      }
    }
  }

  private async tick(): Promise<void> {
    if (this.isPaused || this.stopped) return;

    // Check if SSID has expired
    const poClient = getPocketOptionClient(this.userId);
    if (poClient && poClient.isSsidExpired) {
      this.pause("SSID_EXPIRED");
      return;
    }

    // Check subscription is still active
    const hasAccess = await hasActiveSubscription(this.userId);
    if (!hasAccess) {
      this.pause("Abonnement expiré");
      return;
    }

    // Get candles from cache
    const candles = candleCache.getCandlesForTimeframe(
      this.asset,
      this.timeframe,
      100
    );

    // Need at least 50 candles for signal generation
    if (candles.length < 50) return;

    // Generate signal using real data
    const signal = generateSignal(candles, this.asset, this.timeframe);
    if (!signal) {
      // No signal detected this tick, not an error
      this.consecutiveErrors = 0;
      return;
    }

    this.consecutiveErrors = 0;
    this.lastSignalAt = Date.now();
    this.signalsGenerated++;

    // Save signal to DB
    await this.saveSignal(signal);

    // Auto mode: execute trade if confidence >= threshold
    const threshold = this.confidenceMode === "high"
      ? HIGH_CONFIDENCE_THRESHOLD
      : AUTO_TRADE_CONFIDENCE_THRESHOLD;
    if (this.botType === "auto" && signal.confidence >= threshold) {
      await this.executeAutoTrade(signal, candles);
    }

    // Update bot session stats
    await this.updateSessionStats();
  }

  private async saveSignal(signal: Signal): Promise<void> {
    try {
      await db.insert(signals).values({
        userId: this.userId,
        asset: signal.asset,
        direction: signal.direction,
        timeframe: signal.timeframe,
        confidence: signal.confidence.toFixed(2),
        rsi: signal.indicators.rsi.toFixed(4),
        macd: signal.indicators.macd.toFixed(8),
        ema: signal.indicators.ema9.toFixed(8),
        bollinger: {
          upper: signal.indicators.bollingerUpper,
          middle: signal.indicators.bollingerMiddle,
          lower: signal.indicators.bollingerLower,
        },
        stochastic: signal.indicators.stochastic.toFixed(4),
        multiTimeframeConfirmation: signal.multiTimeframeConfirmation,
        isActive: true,
      });
    } catch {
      // Signal save failure is non-critical
    }
  }

  private async executeAutoTrade(
    signal: Signal,
    candles: Candle[]
  ): Promise<void> {
    const currentPrice = candles[candles.length - 1]?.close;
    try {
      const result = await executeTrade(this.userId, {
        asset: signal.asset,
        direction: signal.direction,
        amount: this.tradeAmount,
        timeframe: signal.timeframe,
        openPrice: currentPrice,
        mode: this.mode,
        isAutomatic: true,
      });

      if (result.trade) {
        this.tradesExecuted++;
      }
    } catch {
      // Trade execution failure - increment error counter but don't pause
      // (the trade might fail for legitimate reasons like insufficient balance)
    }
  }

  private async updateSessionStats(): Promise<void> {
    try {
      // Find the active session for this user
      const [session] = await db
        .select()
        .from(botSessions)
        .where(eq(botSessions.userId, this.userId))
        .orderBy(desc(botSessions.startedAt))
        .limit(1);

      if (!session || !session.isRunning) return;

      // Get updated trade counts
      const tradeStats = await db
        .select({
          total: botSessions.totalTrades,
          wins: botSessions.wins,
          losses: botSessions.losses,
          totalProfit: botSessions.totalProfit,
        })
        .from(botSessions)
        .where(eq(botSessions.id, session.id));

      // Count actual trades from DB for accuracy
      const userTrades = await db
        .select()
        .from(trades)
        .where(eq(trades.userId, this.userId))
        .orderBy(desc(trades.openedAt));

      const isAuto = userTrades.filter((t) => t.isAutomatic);
      const wins = isAuto.filter((t) => t.result === "WIN").length;
      const losses = isAuto.filter((t) => t.result === "LOSS").length;
      const totalProfit = isAuto.reduce((sum, t) => sum + parseFloat(t.profit || "0"), 0);

      await db
        .update(botSessions)
        .set({
          totalTrades: isAuto.length,
          wins,
          losses,
          totalProfit: totalProfit.toFixed(2),
        })
        .where(eq(botSessions.id, session.id));
    } catch {
      // Stats update failure is non-critical
    }
  }
}

// ============ GLOBAL RUNNER MANAGEMENT ============

const activeRunners = new Map<number, BotRunner>();

export function startBotRunner(opts: {
  userId: number;
  botType: "signal" | "auto";
  asset: string;
  timeframe: Timeframe;
  mode: "DEMO" | "LIVE";
  tradeAmount?: number;
  confidenceMode?: "standard" | "high";
}): BotRunner {
  // Stop existing runner if any
  const existing = activeRunners.get(opts.userId);
  if (existing) {
    existing.stop();
  }

  const runner = new BotRunner(opts);
  runner.start();
  activeRunners.set(opts.userId, runner);
  return runner;
}

export function stopBotRunner(userId: number): void {
  const runner = activeRunners.get(userId);
  if (runner) {
    runner.stop();
    activeRunners.delete(userId);
  }
}

export function getBotRunner(userId: number): BotRunner | undefined {
  return activeRunners.get(userId);
}

export function isBotRunning(userId: number): boolean {
  const runner = activeRunners.get(userId);
  return runner !== undefined && runner.running;
}

export function getAllRunnersStatus(): ReturnType<BotRunner["getStatus"]>[] {
  return Array.from(activeRunners.values()).map((r) => r.getStatus());
}
