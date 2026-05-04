// BotRunner - Background trading loop per user
// Signal mode: generates signals from real candle data
// Auto mode: generates signals + executes trades when confidence >= threshold
// Risk management: user-defined dollar profit target and loss limit

import { db } from "@/db";
import { botSessions, signals, trades, users } from "@/db/schema";
import { eq, desc, and, gte } from "drizzle-orm";
import {
  generateSignal,
  type Timeframe,
  type Signal,
  type Candle,
  TIMEFRAMES,
} from "@/lib/trading";
import { candleCache } from "@/lib/candle-cache";
import { PocketOptionClient } from "@/lib/pocketoption/client";
import { getPocketOptionClient, executeTrade } from "@/services/trading.service";
import { hasActiveSubscription } from "@/services/payment.service";

// ============ CONFIG ============

const AUTO_TRADE_CONFIDENCE_THRESHOLD = 70; // Minimum confidence % to auto-trade (standard mode)
const HIGH_CONFIDENCE_THRESHOLD = 80; // Minimum confidence % for high confidence mode
const MAX_CONSECUTIVE_ERRORS = 10;
const DEFAULT_PROFIT_TARGET = 50; // Default $50 profit target
const DEFAULT_LOSS_LIMIT = 25; // Default $25 loss limit

function getLoopIntervalMs(timeframe: string): number {
  const sec = timeframe.endsWith("s")
    ? parseInt(timeframe)
    : timeframe === "1m"
    ? 60
    : timeframe === "3m"
    ? 180
    : 300;
  // Faster intervals for better real-time execution
  if (sec <= 15) return 1000; // 1s for scalping
  if (sec <= 30) return 2000; // 2s
  if (sec <= 60) return 5000; // 5s for 1m
  if (sec <= 180) return 15000; // 15s for 3m
  return 30000; // 30s for 5m+
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
  readonly profitTarget: number;
  readonly lossLimit: number;
  // Martingale
  readonly martingaleEnabled: boolean;
  private baseTradeAmount: number;
  private martingaleLevel = 0; // 0 = base, 1 = doubled
  // Compound interest
  readonly compoundEnabled: boolean;
  readonly compoundTradesTarget: number;
  readonly compoundPayoutRate: number;
  private compoundTradesTaken = 0;
  private compoundCurrentAmount: number;
  private compoundInitialAmount: number;

  private intervalHandle: ReturnType<typeof setInterval> | null = null;
  private consecutiveErrors = 0;
  private signalHistory: ("CALL" | "PUT")[] = [];
  private isPaused = false;
  private pauseReason: string | null = null;
  private lastSignalAt: number | null = null;
  private lastTradeDirection: "CALL" | "PUT" | null = null;
  private lastPayout: number | null = null;
  private signalsGenerated = 0;
  private tradesExecuted = 0;
  private dailyWins = 0;
  private dailyLosses = 0;
  private dailyProfit = 0;
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
    profitTarget?: number;
    lossLimit?: number;
    martingaleEnabled?: boolean;
    compoundEnabled?: boolean;
    compoundTradesTarget?: number;
    compoundPayoutRate?: number;
  }) {
    this.userId = opts.userId;
    this.botType = opts.botType;
    this.asset = opts.asset;
    this.timeframe = opts.timeframe;
    this.mode = opts.mode;
    this.tradeAmount = opts.tradeAmount || 1;
    this.baseTradeAmount = this.tradeAmount;
    this.confidenceMode = opts.confidenceMode || "standard";
    this.profitTarget = opts.profitTarget || DEFAULT_PROFIT_TARGET;
    this.lossLimit = opts.lossLimit || DEFAULT_LOSS_LIMIT;
    this.martingaleEnabled = opts.martingaleEnabled || false;
    this.compoundEnabled = opts.compoundEnabled || false;
    this.compoundTradesTarget = opts.compoundTradesTarget || 0;
    this.compoundPayoutRate = opts.compoundPayoutRate || 0.92;
    this.compoundCurrentAmount = this.tradeAmount;
    this.compoundInitialAmount = this.tradeAmount;
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
    profitTarget: number;
    lossLimit: number;
    running: boolean;
    paused: boolean;
    pauseReason: string | null;
    signalsGenerated: number;
    tradesExecuted: number;
    dailyWins: number;
    dailyLosses: number;
    dailyProfit: number;
    consecutiveErrors: number;
    lastSignalAt: number | null;
    startedAt: Date;
    martingaleEnabled: boolean;
    martingaleLevel: number;
    baseTradeAmount: number;
    compoundEnabled: boolean;
    compoundTradesTarget: number;
    compoundTradesTaken: number;
    compoundCurrentAmount: number;
    compoundInitialAmount: number;
    compoundPayoutRate: number;
  } {
    return {
      userId: this.userId,
      botType: this.botType,
      asset: this.asset,
      timeframe: this.timeframe,
      mode: this.mode,
      tradeAmount: this.tradeAmount,
      confidenceMode: this.confidenceMode,
      profitTarget: this.profitTarget,
      lossLimit: this.lossLimit,
      running: this.running,
      paused: this.isPaused,
      pauseReason: this.pauseReason,
      signalsGenerated: this.signalsGenerated,
      tradesExecuted: this.tradesExecuted,
      dailyWins: this.dailyWins,
      dailyLosses: this.dailyLosses,
      dailyProfit: this.dailyProfit,
      consecutiveErrors: this.consecutiveErrors,
      lastSignalAt: this.lastSignalAt,
      startedAt: this.startedAt,
      martingaleEnabled: this.martingaleEnabled,
      martingaleLevel: this.martingaleLevel,
      baseTradeAmount: this.baseTradeAmount,
      compoundEnabled: this.compoundEnabled,
      compoundTradesTarget: this.compoundTradesTarget,
      compoundTradesTaken: this.compoundTradesTaken,
      compoundCurrentAmount: this.compoundCurrentAmount,
      compoundInitialAmount: this.compoundInitialAmount,
      compoundPayoutRate: this.compoundPayoutRate,
    };
  }

  start(): void {
    if (this.intervalHandle) return;

    // Load today's trade stats from DB for risk management
    this.loadDailyStats().catch(() => {});

    const sizeSeconds = this.timeframeToSeconds();

    // The connection might still be establishing in the background
    // We will attempt to subscribe and bootstrap once connected
    const trySetup = () => {
      const poClient = getPocketOptionClient(this.userId);
      if (poClient && poClient.isConnected) {
        console.log(`[BotRunner] Connection established for user ${this.userId}, setting up cache...`);
        candleCache.setClient(poClient);
        candleCache.subscribe(this.asset, sizeSeconds);
        this.bootstrapCandles();
        return true;
      }
      return false;
    };

    // Initial attempt
    if (!trySetup()) {
      console.log(`[BotRunner] Waiting for PO connection for user ${this.userId}...`);
      // Retry setup every 2 seconds until connected
      const setupInterval = setInterval(() => {
        if (trySetup() || this.stopped) {
          clearInterval(setupInterval);
        }
      }, 2000);
    }

    const intervalMs = getLoopIntervalMs(this.timeframe);
    console.log(`[BotRunner] Starting loop for user ${this.userId} with interval ${intervalMs}ms`);
    this.intervalHandle = setInterval(() => {
      this.tick().catch((err) => {
        console.error(`[BotRunner] Tick error for user ${this.userId}:`, err);
        this.consecutiveErrors++;
        if (this.consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
          this.pause("Trop d'erreurs consécutives");
        }
      });
    }, intervalMs);

    // Run first tick after a short delay to let data start flowing
    setTimeout(() => {
      if (!this.stopped) {
        console.log(`[BotRunner] Initial tick for user ${this.userId}`);
        this.tick().catch((err) => console.error(`[BotRunner] Initial tick error:`, err));
      }
    }, 5000); // Increased to 5s to allow bootstrap to finish
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
    console.warn(`[BotRunner] Paused for user ${this.userId}: ${reason}`);
  }

  resume(): void {
    this.isPaused = false;
    this.pauseReason = null;
    this.consecutiveErrors = 0;
  }

  resetCompound(): void {
    this.compoundCurrentAmount = this.compoundInitialAmount;
    this.compoundTradesTaken = 0;
    this.martingaleLevel = 0;
    this.isPaused = false;
    this.pauseReason = null;
    console.log(`[BotRunner] Compound reset for user ${this.userId}, amount=$${this.compoundInitialAmount}`);
  }

  // ============ PRIVATE ============

  private async loadDailyStats(): Promise<void> {
    try {
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);

      const todayTrades = await db
        .select()
        .from(trades)
        .where(
          and(
            eq(trades.userId, this.userId),
            eq(trades.isAutomatic, true),
            gte(trades.openedAt, todayStart)
          )
        );

      this.dailyWins = todayTrades.filter((t) => t.result === "WIN").length;
      this.dailyLosses = todayTrades.filter((t) => t.result === "LOSS").length;
      this.dailyProfit = todayTrades.reduce((sum, t) => sum + parseFloat(t.profit || "0"), 0);
    } catch {
      // Stats load failure is non-critical
    }
  }

  private timeframeToSeconds(): number {
    const tf = this.timeframe;
    if (tf.endsWith("s")) return parseInt(tf);
    if (tf.endsWith("m")) return parseInt(tf) * 60;
    return 60;
  }

  /** Cooldown period after a signal to prevent over-trading */
  private getSignalCooldownMs(): number {
    const sec = this.timeframeToSeconds();
    // At least 1 candle duration, scaled by timeframe
    if (sec <= 15) return 10_000;   // 10s for scalping
    if (sec <= 30) return 20_000;   // 20s
    if (sec <= 60) return 60_000;   // 60s for 1m
    if (sec <= 180) return 180_000; // 3min for 3m
    return 300_000;                 // 5min for 5m
  }

  private async bootstrapCandles(): Promise<void> {
    const client = getPocketOptionClient(this.userId);
    if (client && client.isConnected) {
      try {
        const sizeSeconds = this.timeframeToSeconds();
        console.log(`[BotRunner] Bootstrapping candles for ${this.asset} (${this.timeframe})...`);
        
        // Strategy: Ensure subscription is active first
        client.changeSymbol(this.asset, sizeSeconds);
        await new Promise(r => setTimeout(r, 1000)); // Give PO a second to start streaming
        
        const historicalCandles = await client.requestCandleHistory(
          this.asset,
          sizeSeconds,
          200
        );
        
        if (historicalCandles.length > 0) {
          candleCache.seedCandles(this.asset, sizeSeconds, historicalCandles);
          console.log(`[BotRunner] Bootstrapped ${historicalCandles.length} candles for ${this.asset}`);
        } else {
          console.warn(`[BotRunner] No historical candles returned for ${this.asset}`);
        }
      } catch (err) {
        console.error(`[BotRunner] Historical bootstrap failed for ${this.asset}:`, err);
      }
    } else {
      console.warn(`[BotRunner] Cannot bootstrap candles: Client not connected for user ${this.userId}`);
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

    // Risk management: check dollar-based daily limits
    if (this.dailyProfit <= -this.lossLimit) {
      this.pause(`Limite de perte atteinte: -$${Math.abs(this.dailyProfit).toFixed(2)} (limite: $${this.lossLimit})`);
      return;
    }
    if (this.dailyProfit >= this.profitTarget) {
      this.pause(`Objectif de profit atteint: +$${this.dailyProfit.toFixed(2)} (objectif: $${this.profitTarget})`);
      return;
    }

    // Get candles from cache
    let candles = candleCache.getCandlesForTimeframe(
      this.asset,
      this.timeframe,
      100
    );

    // If cache is empty, try fetching historical candles directly
    if (candles.length < 50 && poClient && poClient.isConnected) {
      try {
        const sizeSeconds = this.timeframeToSeconds();
        const historicalCandles = await poClient.requestCandleHistory(
          this.asset,
          sizeSeconds,
          200
        );
        if (historicalCandles.length > 0) {
          candleCache.seedCandles(this.asset, sizeSeconds, historicalCandles);
          candles = candleCache.getCandlesForTimeframe(
            this.asset,
            this.timeframe,
            100
          );
        }
      } catch {
        // Historical fetch failed, will retry next tick
      }
    }

    // Minimum candles depends on timeframe (scoring engine needs less than old AND gate)
    const sec = this.timeframeToSeconds();
    const minCandles = sec <= 15 ? 20 : sec <= 60 ? 30 : 50;
    
    if (candles.length < minCandles) {
      // If we don't have enough candles, try to bootstrap again occasionally
      if (this.signalsGenerated === 0 && Math.random() < 0.1) {
        console.log(`[BotRunner] Still waiting for data (${candles.length}/${minCandles}). Retrying bootstrap...`);
        this.bootstrapCandles();
      }
      return;
    }

    // Generate signal using scoring engine
    const signal = generateSignal(candles, this.asset, this.timeframe);
    if (!signal) {
      // Insufficient data for signal generation
      this.consecutiveErrors = 0;
      return;
    }

    // Signal cooldown: prevent over-trading on same candle/signal
    // Only check if we already have a signal timestamp
    if (this.lastSignalAt && Date.now() - this.lastSignalAt < this.getSignalCooldownMs()) {
      return;
    }

    // Diagnostic: check if price is actually moving (stale data check)
    const lastThreeCloses = candles.slice(-3).map(c => c.close);
    const isStale = new Set(lastThreeCloses).size === 1;
    if (isStale) {
      console.warn(`[BotRunner] Stale price data detected for ${this.asset}. Skipping tick.`);
      return;
    }

    this.consecutiveErrors = 0;
    
    // Track signal history for diversity diagnostics (all modes)
    this.signalHistory.push(signal.direction);
    if (this.signalHistory.length > 10) this.signalHistory.shift();

    this.signalsGenerated++;
    this.lastTradeDirection = signal.direction;
    this.lastSignalAt = Date.now();

    console.log(`[BotRunner] Signal for user ${this.userId}: ${signal.direction} ${signal.asset} @ ${signal.confidence.toFixed(1)}% confidence (score: ${signal.indicators.signalScore?.toFixed(3) || 'N/A'})`);

    const callCount = this.signalHistory.filter(d => d === "CALL").length;
    const putCount = this.signalHistory.filter(d => d === "PUT").length;
    if (this.signalHistory.length >= 5 && (callCount === 0 || putCount === 0)) {
      console.warn(`[BotRunner] One-sided signal direction detected (${this.signalHistory[0]} x${this.signalHistory.length}). Strategy may be trend-locked.`);
    }

    // Save signal to DB
    await this.saveSignal(signal);

    // LOG DE TEST DIRECT POUR LE USER
    console.log(`\n--- [TEST EN DIRECT] ---`);
    console.log(`Actif: ${this.asset} | Direction: ${signal.direction}`);
    console.log(`Confiance: ${signal.confidence.toFixed(1)}% | Payout: ${this.lastPayout || '?'}`);
    console.log(`------------------------\n`);

    // Auto mode: execute trade if confidence >= threshold
    const threshold = this.confidenceMode === "high"
      ? HIGH_CONFIDENCE_THRESHOLD
      : AUTO_TRADE_CONFIDENCE_THRESHOLD;

    if (this.botType === "auto") {
      if (signal.confidence >= threshold) {
        console.log(`[BotRunner] Confidence ${signal.confidence.toFixed(1)}% >= ${threshold}%. CHECKING PAYOUT for user ${this.userId}...`);
        
        // Anti-ban & Payout check: Get current asset payout before trading
        const client = getPocketOptionClient(this.userId);
        if (client && client.isConnected) {
          const assets = (client as any).assets || {};
          const assetSymbol = PocketOptionClient.toPOSymbol(this.asset);
          const assetInfo = assets[assetSymbol];
          const payout = assetInfo?.payout || 0;
          this.lastPayout = payout;
          
          if (payout > 0 && payout < 0.60) { // Lowered to 60% for more flexibility while still protecting
             console.log(`[BotRunner] Payout too low (${(payout*100).toFixed(0)}% < 60%) for ${assetSymbol}. Skipping trade for user ${this.userId}.`);
             return;
          }
        }

        console.log(`[BotRunner] Payout OK. Executing trade for user ${this.userId}...`);
        await this.executeAutoTrade(signal, candles);
      } else {
        console.log(`[BotRunner] Confidence ${signal.confidence.toFixed(1)}% below threshold ${threshold}%. Skipping trade for user ${this.userId}.`);
      }
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
        // Legacy indicators
        rsi: signal.indicators.rsi.toFixed(4),
        macd: signal.indicators.macd.toFixed(8),
        ema: signal.indicators.ema9.toFixed(8),
        bollinger: {
          upper: signal.indicators.bollingerUpper,
          middle: signal.indicators.bollingerMiddle,
          lower: signal.indicators.bollingerLower,
        },
        stochastic: signal.indicators.stochastic.toFixed(4),
        // Strategy indicators
        ema20: signal.indicators.ema20.toFixed(8),
        ema50: signal.indicators.ema50.toFixed(8),
        stochK: signal.indicators.stochK.toFixed(4),
        stochD: signal.indicators.stochD.toFixed(4),
        lowFractal: signal.indicators.lowFractal,
        highFractal: signal.indicators.highFractal,
        dojiFiltered: signal.indicators.dojiRejected,
        multiTimeframeConfirmation: signal.multiTimeframeConfirmation,
        // Scoring system indicators
        supportLevel: signal.indicators.supportLevel?.toFixed(8) || null,
        resistanceLevel: signal.indicators.resistanceLevel?.toFixed(8) || null,
        nearSupport: signal.indicators.nearSupport,
        nearResistance: signal.indicators.nearResistance,
        marketStructure: signal.indicators.marketStructure,
        structureBreak: signal.indicators.structureBreak,
        signalScore: signal.indicators.signalScore?.toFixed(4) || null,
        bollingerPercentB: signal.indicators.bollingerPercentB?.toFixed(4) || null,
        bollingerWidth: signal.indicators.bollingerWidth?.toFixed(6) || null,
        indicatorScores: signal.indicators.indicatorScores || null,
        diagnostic: signal.diagnostic,
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

    // Double-check dollar-based daily limits before executing
    if (this.dailyProfit <= -this.lossLimit) {
      this.pause(`Limite de perte atteinte: -$${Math.abs(this.dailyProfit).toFixed(2)} (limite: $${this.lossLimit})`);
      return;
    }
    if (this.dailyProfit >= this.profitTarget) {
      this.pause(`Objectif de profit atteint: +$${this.dailyProfit.toFixed(2)} (objectif: $${this.profitTarget})`);
      return;
    }

    // Determine the effective trade amount
    let effectiveAmount = this.tradeAmount;
    if (this.compoundEnabled) {
      effectiveAmount = this.compoundCurrentAmount;
    } else if (this.martingaleEnabled && this.martingaleLevel === 1) {
      effectiveAmount = this.baseTradeAmount * 2;
    }

    try {
      const result = await executeTrade(this.userId, {
        asset: signal.asset,
        direction: signal.direction,
        amount: effectiveAmount,
        timeframe: signal.timeframe,
        openPrice: currentPrice,
        mode: this.mode,
        isAutomatic: true,
      });

      if (result.trade) {
        const isWin = result.profit > 0;
        this.tradesExecuted++;

        // Update daily risk tracking
        if (isWin) {
          this.dailyWins++;
        } else {
          this.dailyLosses++;
        }
        this.dailyProfit += result.profit;

        // === Compound interest logic ===
        if (this.compoundEnabled) {
          if (isWin) {
            // Compound: add profit to current amount
            this.compoundCurrentAmount = this.compoundCurrentAmount + (this.compoundCurrentAmount * this.compoundPayoutRate);
            this.compoundTradesTaken++;
            console.log(`[BotRunner] Compound WIN #${this.compoundTradesTaken}/${this.compoundTradesTarget}: amount now $${this.compoundCurrentAmount.toFixed(2)}`);

            if (this.compoundTradesTaken >= this.compoundTradesTarget) {
              this.pause(`Compound: Objectif atteint! ${this.compoundTradesTaken} trades reussis. Montant final: $${this.compoundCurrentAmount.toFixed(2)}`);
              return;
            }
          } else {
            // LOSS in compound: STOP immediately
            this.pause(`Compound: Perte au trade #${this.compoundTradesTaken + 1}. Montant perdu: $${effectiveAmount.toFixed(2)}`);
            return;
          }
        }

        // === Martingale logic (only if compound is not active) ===
        if (this.martingaleEnabled && !this.compoundEnabled) {
          if (!isWin && this.martingaleLevel === 0) {
            // Loss on base amount: activate martingale (double next trade)
            this.martingaleLevel = 1;
            console.log(`[BotRunner] Martingale activated: next trade will be $${(this.baseTradeAmount * 2).toFixed(2)}`);
          } else {
            // Win OR loss on doubled trade: reset to base
            this.martingaleLevel = 0;
          }
        }

        // Check limits after trade
        if (this.dailyProfit <= -this.lossLimit) {
          this.pause(`Limite de perte atteinte: -$${Math.abs(this.dailyProfit).toFixed(2)}`);
        } else if (this.dailyProfit >= this.profitTarget) {
          this.pause(`Objectif de profit atteint: +$${this.dailyProfit.toFixed(2)}`);
        }

        const amountStr = effectiveAmount !== this.tradeAmount ? `$${effectiveAmount.toFixed(2)}` : `$${this.tradeAmount}`;
        console.log(`[BotRunner] Trade executed: ${signal.direction} ${signal.asset} amount=${amountStr} profit=${result.profit.toFixed(2)} dailyP/L=$${this.dailyProfit.toFixed(2)} (W:${this.dailyWins}/L:${this.dailyLosses})`);
      }
    } catch (err) {
      console.error(`[BotRunner] Trade execution failed:`, err);
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
  profitTarget?: number;
  lossLimit?: number;
  martingaleEnabled?: boolean;
  compoundEnabled?: boolean;
  compoundTradesTarget?: number;
  compoundPayoutRate?: number;
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
