// BotRunner - Background trading loop per user
// Signal mode: generates signals from real candle data
// Auto mode: generates signals + executes trades when confidence >= threshold
// Risk management: user-defined dollar profit target and loss limit

import { db } from "@/db";
import { botSessions, signals, trades, users } from "@/db/schema";
import { eq, desc, and, gte } from "drizzle-orm";
import {
  generateSignal,
  calculateRSI,
  calculateEMA,
  calculateMACD,
  type Timeframe,
  type Signal,
  type Candle,
  TIMEFRAMES,
} from "@/lib/trading";
import { OrchestratorAgent } from "../core/agents/OrchestratorAgent";
import { candleCache } from "@/lib/candle-cache";
import { externalDataService } from "@/services/external-data.service";
import { RiskManager } from "@/services/risk-manager.service";
import { getPocketOptionClient, executeTrade } from "@/services/trading.service";
import { tradeMutexManager } from "@/services/trade-mutex.manager";
import { hasActiveSubscription } from "@/services/payment.service";

import { DataOrchestrator, NonOtcSignalGenerator } from "@/services/data-orchestrator.service";
import { signalTracker } from "@/services/signal-tracker";
import { validateBalance, updateBalanceCache } from "@/services/balance-validator.service";

// ============ CONFIG ============

const AUTO_TRADE_CONFIDENCE_THRESHOLD = 50; // V6: OrchestratorAgent score range, 50=seuil minimum
const HIGH_CONFIDENCE_THRESHOLD = 70;         // V6: 70+ = HIGH confidence
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
  private setupInterval: ReturnType<typeof setInterval> | null = null;
  private firstTickTimeout: ReturnType<typeof setTimeout> | null = null;
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
  private isReconnecting = false;

  // ─── Connection State Machine ───────────────────────────────────────────
  private ssidExpiredFinal = false;
  private reconnectAttempts = 0;
  private readonly MAX_RECONNECT_ATTEMPTS = 15;  // Fix 3: was 5, too low for Render
  private lastReconnectAt = 0;
  private readonly MIN_RECONNECT_COOLDOWN_MS = 8000;
  private isTickRunning = false; // Fix 1: prevent re-entrant tick

  // New Strategy State Management
  private lastProcessedTimestamp = 0;
  private isInPosition = false;
  private currentTradeId: string | null = null;
  private riskManager: RiskManager;
  // Force-signal timeout: reset lastProcessedTimestamp if stuck for > 2x timeframe
  private lastSignalGeneratedAt = 0;
  // Sniper lock: prevent trading for a specific duration after a trade
  private cooldownUntil = 0;

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

    this.riskManager = new RiskManager({
      dailyLossLimit: this.lossLimit,
      dailyProfitTarget: this.profitTarget,
      maxPositionSize: this.tradeAmount * 5,
      riskPerTradePercent: 2
    });
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

    // Reset signal gate: ensure bot processes the NEXT candle immediately
    // Without this, a restarted runner uses stale timestamps and waits silently
    this.lastProcessedTimestamp = 0;
    this.lastSignalGeneratedAt = 0;
    this.cooldownUntil = 0;

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
      this.setupInterval = setInterval(() => {
        if (trySetup() || this.stopped) {
          if (this.setupInterval) clearInterval(this.setupInterval);
          this.setupInterval = null;
        }
      }, 2000);
    }

    const intervalMs = getLoopIntervalMs(this.timeframe);
    console.log(`[BotRunner] Starting loop for user ${this.userId} with interval ${intervalMs}ms`);
    this.intervalHandle = setInterval(() => {
      if (this.stopped || this.isPaused) return;
      if (this.isTickRunning) return; // Fix 1: skip if previous tick still running
      this.isTickRunning = true;
      this.tick()
        .catch((err) => {
          console.error(`[BotRunner] Tick error for user ${this.userId}:`, err);
          this.consecutiveErrors++;
          if (this.consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
            this.pause("Trop d'erreurs consécutives");
          }
        })
        .finally(() => { this.isTickRunning = false; });
    }, intervalMs);

    // Run first tick after a short delay to let data start flowing
    this.firstTickTimeout = setTimeout(() => {
      if (!this.stopped && !this.isPaused) {
        console.log(`[BotRunner] Initial tick for user ${this.userId}`);
        this.tick().catch((err) => console.error(`[BotRunner] Initial tick error:`, err));
      }
      this.firstTickTimeout = null;
    }, 5000); // Increased to 5s to allow bootstrap to finish
  }

  stop(): void {
    this.stopped = true;
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
    if (this.setupInterval) {
      clearInterval(this.setupInterval);
      this.setupInterval = null;
    }
    if (this.firstTickTimeout) {
      clearTimeout(this.firstTickTimeout);
      this.firstTickTimeout = null;
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
    this.reconnectAttempts = 0;  // Fix 2: reset so Bridge sync doesn't trigger immediate re-pause
    this.isTickRunning = false;  // Fix 1: unblock tick if frozen
    console.log(`[BotRunner] Resumed for user ${this.userId}`);
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
      // Compter uniquement les trades depuis le lancement de la session courante
      const sessionStart = this.startedAt;

      const todayTrades = await db
        .select()
        .from(trades)
        .where(
          and(
            eq(trades.userId, this.userId),
            eq(trades.isAutomatic, true),
            gte(trades.openedAt, sessionStart)
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

    // === 1. State Management: Prevent multiple simultaneous trades ===
    const tradeKey = tradeMutexManager.getTradeKey(this.userId, this.asset, this.timeframe);
    const cooldownKey = tradeMutexManager.getCooldownKey(this.userId, this.asset, this.timeframe);

    if (this.isInPosition) {
      return;
    }

    if (Date.now() < this.cooldownUntil || tradeMutexManager.isCooldownActive(cooldownKey)) {
      return;
    }

    // Acquire lock for this tick evaluation
    if (!tradeMutexManager.acquireLock(tradeKey, 60000)) {
      return; // Already evaluating or trading for this user/asset/tf
    }

    try {
      // We are inside the locked section. All returns from here on must be wrapped or handled so we release the lock in the finally block.

    // === 1. STATE MACHINE: SSID_EXPIRED is a FINAL blocking state — no reconnect ever ===
    let poClient = getPocketOptionClient(this.userId);

    // Check SSID expiry FIRST — before any reconnect attempt
    if (this.ssidExpiredFinal || (poClient && poClient.isSsidExpired)) {
      if (!this.ssidExpiredFinal) {
        console.warn(`[BotRunner] SSID_EXPIRED detected for user ${this.userId} — entering final halt state`);
        this.ssidExpiredFinal = true;
      }
      this.pause("SSID_EXPIRED");
      return;
    }

    // === Auto-Reconnect: if PO client is missing or disconnected ===
    if (!poClient || !poClient.isConnected) {
      if (this.isReconnecting) {
        return; // Already reconnecting
      }

      // Anti-spam: enforce minimum cooldown between reconnects
      const now = Date.now();
      if (now - this.lastReconnectAt < this.MIN_RECONNECT_COOLDOWN_MS) {
        return;
      }

      // Max reconnect attempts guard
      if (this.reconnectAttempts >= this.MAX_RECONNECT_ATTEMPTS) {
        console.error(`[BotRunner] Max reconnect attempts (${this.MAX_RECONNECT_ATTEMPTS}) reached for user ${this.userId} — pausing bot`);
        this.pause("MAX_RECONNECT_REACHED");
        return;
      }

      console.warn(`[BotRunner] PocketOption not connected for user ${this.userId} — forcing reconnect (attempt ${this.reconnectAttempts + 1}/${this.MAX_RECONNECT_ATTEMPTS})...`);
      this.isReconnecting = true;
      this.lastReconnectAt = now;
      this.reconnectAttempts++;
      try {
        const { connectPocketOption, getGlobalSsid } = await import("@/services/trading.service");
        const { getUserProfile, getDecryptedSSID } = await import("@/services/auth.service");
        const isDemo = this.mode === "DEMO";

        // 1. Try personal SSID from DB
        let ssid = "";
        const profile = await getUserProfile(this.userId);
        if (profile?.pocketOptionSsid) {
          ssid = getDecryptedSSID(profile);
        }

        // 2. Fallback to global SSID (admin-provided)
        if (!ssid) {
          ssid = await getGlobalSsid();
        }

        if (!ssid) {
          console.warn(`[BotRunner] No SSID found for user ${this.userId} — cannot reconnect`);
          this.isReconnecting = false;
        } else {
          connectPocketOption(this.userId, ssid, isDemo).then(r => {
            if (r.success) {
              console.log(`[BotRunner] Auto-reconnect succeeded for user ${this.userId}`);
              this.reconnectAttempts = 0; // Reset counter on success
            } else {
              console.warn(`[BotRunner] Auto-reconnect failed: ${r.error}`);
              // If SSID expired during reconnect, set final halt
              if (r.ssidExpired) this.ssidExpiredFinal = true;
            }
            this.isReconnecting = false;
          }).catch(() => {
            this.isReconnecting = false;
          });
        }
      } catch {
        this.isReconnecting = false;
      }
      return; // Always return after triggering reconnect — let next tick evaluate
    }

    // Reconnect succeeded: reset counter
    this.reconnectAttempts = 0;

    // Check if SSID has expired on the now-connected client
    poClient = getPocketOptionClient(this.userId);
    if (poClient && poClient.isSsidExpired) {
      this.ssidExpiredFinal = true;
      this.pause("SSID_EXPIRED");
      return;
    }

    // Check subscription
    const hasAccess = await hasActiveSubscription(this.userId);
    if (!hasAccess) {
      this.pause("Abonnement expiré");
      return;
    }

    // Risk management
    if (this.dailyProfit <= -this.lossLimit) {
      this.pause(`Limite de perte atteinte: -$${Math.abs(this.dailyProfit).toFixed(2)}`);
      return;
    }
    if (this.dailyProfit >= this.profitTarget) {
      this.pause(`Objectif de profit atteint: +$${this.dailyProfit.toFixed(2)}`);
      return;
    }

    // === 2. Data & Candle Manager: External-First Architecture ===
    const isOTC = this.asset.toUpperCase().includes("OTC") || this.asset.toLowerCase().includes("_otc");
    let candles: Candle[] = [];
    const sizeSeconds = this.timeframeToSeconds();

    if (!isOTC) {
      // MISSION 2: Analyse stable via sources externes fiables
      console.log(`[BotRunner] Mode External-First pour ${this.asset}. Analyse en cours...`);
      const externalSignal = await NonOtcSignalGenerator.generateSignal(this.asset, this.timeframe);
      
      if (externalSignal) {
        candles = externalSignal.candles;
        console.log(`[BotRunner] Signal externe validé pour ${this.asset} [${externalSignal.signal}]`);
      } else {
        console.warn(`[BotRunner] Échec de la récupération des données externes pour ${this.asset}. Tentative PO...`);
        candles = candleCache.getCandlesForTimeframe(this.asset, this.timeframe, 300);
      }
    } else {
      // OTC: mandatory PO cache
      candles = candleCache.getCandlesForTimeframe(this.asset, this.timeframe, 300);
    }

    console.log(`[BotRunner] Tick user ${this.userId} - ${this.asset} (${this.timeframe}) - Candles: ${candles.length} (OTC: ${isOTC})`);

    // Bootstrap if OTC and not enough candles — request from PO server
    if (isOTC && candles.length < 30 && poClient && poClient.isConnected) {
      try {
        console.log(`[BotRunner] OTC cache low (${candles.length}), fetching history for ${this.asset}...`);
        const historical = await poClient.requestCandleHistory(this.asset, sizeSeconds, 200);
        if (historical.length > 0) {
          candleCache.seedCandles(this.asset, sizeSeconds, historical);
          candles = candleCache.getCandlesForTimeframe(this.asset, this.timeframe, 300);
          console.log(`[BotRunner] OTC seeded with ${historical.length} candles. Now: ${candles.length}`);
        }
      } catch (err) {
        console.error(`[BotRunner] OTC history request failed:`, err);
      }
    }

    // === If still no candles at all, wait one tick then continue — never block permanently ===
    if (candles.length === 0) {
      if (!poClient || !poClient.isConnected) {
        console.warn(`[BotRunner] Pause Réseau: Attente de la reconnexion PO pour ${this.asset}...`);
        return;
      }
      console.warn(`[BotRunner] Zero candles for ${this.asset}. Will retry next tick.`);
      this.consecutiveErrors++;
      return;
    }
    this.consecutiveErrors = 0;
    // Log data quality
    if (candles.length < 20) {
      console.log(`[BotRunner] Low data (${candles.length} candles) — using lightweight signal engine.`);
    }

    // === 3. Trigger only on Candle Close ===
    // candles[length - 1] is the current live candle.
    // candles[length - 2] is the last confirmed closed candle.
    // If we have only 1 candle, treat it as the closed one.
    const lastClosedCandle = candles.length >= 2
      ? candles[candles.length - 2]
      : candles[candles.length - 1];

    // Check if we already processed this closed candle
    if (lastClosedCandle.timestamp <= this.lastProcessedTimestamp) {
      // Force-signal safety valve: if we've been stuck for > 2x timeframe, reset
      const stuckMs = Date.now() - this.lastSignalGeneratedAt;
      const forceAfterMs = this.timeframeToSeconds() * 2 * 1000;
      if (this.lastSignalGeneratedAt > 0 && stuckMs > forceAfterMs) {
        console.warn(`[BotRunner] ⚠️  Signal bloqué depuis ${Math.round(stuckMs / 1000)}s (max: ${forceAfterMs / 1000}s) — reset lastProcessedTimestamp pour forcer un signal`);
        this.lastProcessedTimestamp = 0;
        // Don't return — fall through to generate the signal
      } else {
        return; // Normal skip: candle already processed
      }
    }

    this.lastProcessedTimestamp = lastClosedCandle.timestamp;

    // The TechnicalAnalysisAgent requires at least 30 candles
    // Get up to 300 historical candles from cache directly instead of the subset
    // This fixes the "Au moins 30 bougies sont nécessaires" error while still 
    // using the `analysisCandles` subset to avoid triggering on the live unclosed candle.
    const allCandles = candleCache.getCandlesForTimeframe(this.asset, this.timeframe, 300);
    const analysisCandles = allCandles.length >= 2 ? allCandles.slice(0, -1) : allCandles;

    if (analysisCandles.length < 10) {
      console.warn(`[BotRunner] Pas assez de bougies pour l'analyse IA (${analysisCandles.length}/10). Attente...`);
      return;
    }

    // === 4. Intelligence Artificielle (Agents 1 & 2) ===
    // Remplace l'ancien moteur monolithique par la nouvelle architecture IA (Cerveau + Juge)
    const isOtc = this.asset.toUpperCase().includes("OTC");
    const strategy = await OrchestratorAgent.evaluate(analysisCandles, this.asset, this.timeframe, isOtc);
    
    // Extraction de la probabilité réelle
    const probaValue = strategy.score;

    // Log the generated signal
    console.log(`[BotRunner] Signal: ${strategy.signal} (${strategy.confidence}) — ${strategy.reason}`);

    // If signal is WAIT, do not execute
    if (strategy.signal === "WAIT") {
      return;
    }

    // Prepare Signal Object
    const signal: Signal = {
      signal: strategy.signal,
      confidence: strategy.confidence,
      timeframe: this.timeframe,
      timestamp: new Date().toISOString().replace('T', ' ').split('.')[0],
      price_current: lastClosedCandle.close,
      asset: this.asset,
      
      bollinger: {
        signal: strategy.signal as any,
        upper: lastClosedCandle.close, // Fallback for legacy format
        middle: lastClosedCandle.close,
        lower: lastClosedCandle.close,
        price_position: "middle"
      },

      stochastic: {
        signal: strategy.signal as any,
        k_value: 50,
        d_value: 50,
        zone: "neutral",
        crossover: false
      },

      reason: strategy.reason,
      action: strategy.confidence === "HIGH" ? "ENTRER MAINTENANT" : strategy.confidence === "MEDIUM" ? "ATTENDRE" : "ÉVITER",
      
      // Internal/Legacy fields for compatibility
      direction: strategy.signal === "BUY" ? "CALL" : "PUT",
      confidence_score: probaValue,
      indicators: {
        rsi: calculateRSI(analysisCandles.map(c => c.close)),
        macd: calculateMACD(analysisCandles.map(c => c.close)).macd,
        ema9: calculateEMA(analysisCandles.map(c => c.close), 9),
        bollingerUpper: lastClosedCandle.close,
        bollingerMiddle: lastClosedCandle.close,
        bollingerLower: lastClosedCandle.close,
        stochastic: 50,
        stochasticSignal: 50,
        ema20: lastClosedCandle.close,
        ema50: calculateEMA(analysisCandles.map(c => c.close), 50),
        stochK: 50,
        stochD: 50,
        lowFractal: false,
        highFractal: false,
        dojiRejected: false,
        atr: 0,
        bollingerPercentB: 0,
        bollingerWidth: 0,
        supportLevel: 0,
        resistanceLevel: 0,
        nearSupport: false,
        nearResistance: false,
        marketStructure: "NEUTRAL",
        structureBreak: "NONE",
        signalScore: strategy.confidence === "HIGH" ? 1.0 : 0.5,
        indicatorScores: { bollinger: 0, stochastic: 0 }
      },
      multiTimeframeConfirmation: {},
      diagnostic: strategy.reason
    };

    // Update state before execution (lastProcessedTimestamp already set at line 538)
    this.lastSignalGeneratedAt = Date.now();
    this.signalsGenerated++;
    this.lastSignalAt = Date.now();
    this.lastTradeDirection = signal.direction;

    const displayDirection = signal.direction === "CALL" ? "CALL (HAUT)" : "PUT (BAS)";
    console.log(`[BotRunner] NOUVEAU SIGNAL DETECTE: ${displayDirection} [Confiance: ${signal.confidence}] sur ${this.asset} (${this.timeframe})`);
    console.log(`[BotRunner] Raison: ${signal.reason}`);

    // Track signal for traceability
    const signalId = await signalTracker.logSignal({
      timestamp: Date.now(),
      asset: this.asset,
      direction: signal.direction,
      timeframe: this.timeframe,
      entryPrice: analysisCandles[analysisCandles.length - 1].close,
      confidence: signal.confidence_score,
    });

    // Save to DB
    await this.saveSignal(signal);

    // === 5. Trade Execution & State Management ===
    if (this.botType === "auto") {
      // Validate balance before trading
      const balanceCheck = await validateBalance(this.userId, this.tradeAmount, this.mode);
      if (!balanceCheck.valid) {
        console.warn(`[BotRunner] ⚠️  Trade bloqué: ${balanceCheck.error} (source: ${balanceCheck.balance.source})`);
        return;
      }
      console.log(`[BotRunner] ✅ Solde validé: $${balanceCheck.balance.balance.toFixed(2)} (source: ${balanceCheck.balance.source})`);

      // Vérification/Reconnexion Pocket Option AVANT le trade
      if (!poClient || !poClient.isConnected) {
        console.warn(`[BotRunner] Signal prêt mais PO déconnecté. Tentative de reconnexion express pour ${this.asset}...`);
        await this.reconnectExpress();
        poClient = getPocketOptionClient(this.userId);
      }

      if (!poClient || !poClient.isConnected) {
        console.error(`[BotRunner] ❌ Trade bloqué: PO reste déconnecté après reconnexion express. Signal: ${signal.direction} ${signal.asset}`);
        console.error(`[BotRunner] Vérifiez que le SSID est valide et que le Bridge est connecté.`);
        return;
      }

      // Check confidence threshold before executing
      const threshold = this.confidenceMode === "high" ? HIGH_CONFIDENCE_THRESHOLD : AUTO_TRADE_CONFIDENCE_THRESHOLD;
      if (signal.confidence_score < threshold) {
        console.log(`[BotRunner] ⚠️  Signal ignoré — Score ${signal.confidence_score}% < seuil ${threshold}% (mode: ${this.confidenceMode})`);
        await this.updateSessionStats();
        return;
      }
      console.log(`[BotRunner] ✅ Seuil OK: ${signal.confidence_score}% >= ${threshold}% — Exécution du trade...`);

      // Lock position until trade is finished
      this.isInPosition = true;

      try {
        console.log(`[BotRunner] Entrée en position: ${signal.direction} $${this.tradeAmount} (confidence: ${signal.confidence_score}%)`);  
        // executeAutoTrade calls executeTrade which calls poClient.placeTrade (which waits for expiry)
        const result = await this.executeAutoTrade(signal, analysisCandles);
        
        // Update signal tracker with result
        if (result && result.trade) {
          const res = (result as any).profit > 0 ? 'WIN' : 'LOSS';
          // Note: signalId must be in scope from earlier code
          if (typeof signalId !== 'undefined') {
            await signalTracker.updateResult(signalId, res, (result as any).closePrice || 0, (result as any).profit);
          }
        }
      } catch (err) {
        console.error(`[BotRunner] Erreur lors de l'exécution du trade:`, err);
      } finally {
        // Unlock once trade is finished
        this.isInPosition = false;
        
        // Sniper Cooldown: Lock for timeframe duration to avoid spamming same setup
        const cooldownMs = this.timeframeToSeconds() * 1000;
        console.log(`[BotRunner] Sortie de position. Sniper Lock actif pendant ${cooldownMs/1000}s...`);
        this.cooldownUntil = Date.now() + cooldownMs;
        tradeMutexManager.setCooldown(cooldownKey, cooldownMs);
      }
    }

    await this.updateSessionStats();
    } finally {
      // Always release the tick lock at the end of the tick
      if (!this.isInPosition) {
        tradeMutexManager.releaseLock(tradeKey);
      }
    }
  }

  private async saveSignal(signal: Signal): Promise<void> {
    try {
      await db.insert(signals).values({
        userId: this.userId,
        asset: signal.asset,
        direction: signal.direction,
        timeframe: signal.timeframe,
        confidence: signal.confidence,
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
  ): Promise<any> {
    const currentPrice = candles[candles.length - 1]?.close;

    // Double-check dollar-based daily limits before executing
    if (this.dailyProfit <= -this.lossLimit) {
      this.pause(`Limite de perte atteinte: -$${Math.abs(this.dailyProfit).toFixed(2)} (limite: $${this.lossLimit})`);
      return null;
    }
    if (this.dailyProfit >= this.profitTarget) {
      this.pause(`Objectif de profit atteint: +$${this.dailyProfit.toFixed(2)} (objectif: $${this.profitTarget})`);
      return null;
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

        // Update balance cache with new balance
        if (this.mode === "DEMO") {
          const newDemoBalance = parseFloat(result.newBalance || "0") || this.tradeAmount;
          updateBalanceCache(this.userId, newDemoBalance);
        }

        // === Compound interest logic ===
        if (this.compoundEnabled) {
          if (isWin) {
            // Compound: add profit to current amount
            this.compoundCurrentAmount = this.compoundCurrentAmount + (this.compoundCurrentAmount * this.compoundPayoutRate);
            this.compoundTradesTaken++;
            console.log(`[BotRunner] Compound WIN #${this.compoundTradesTaken}/${this.compoundTradesTarget}: amount now $${this.compoundCurrentAmount.toFixed(2)}`);

            if (this.compoundTradesTaken >= this.compoundTradesTarget) {
              this.pause(`Compound: Objectif atteint! ${this.compoundTradesTaken} trades reussis. Montant final: $${this.compoundCurrentAmount.toFixed(2)}`);
              return result;
            }
          } else {
            // LOSS in compound: STOP immediately
            this.pause(`Compound: Perte au trade #${this.compoundTradesTaken + 1}. Montant perdu: $${effectiveAmount.toFixed(2)}`);
            return result;
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
        return result;
      }
      return null;
    } catch (err) {
      console.error(`[BotRunner] Trade execution failed:`, err);
      return null;
    }
  }

  private async reconnectExpress(): Promise<void> {
    try {
      const { connectPocketOption, getGlobalSsid } = await import("@/services/trading.service");
      const { getUserProfile, getDecryptedSSID } = await import("@/services/auth.service");
      const isDemo = this.mode === "DEMO";

      let ssid = "";
      const profile = await getUserProfile(this.userId);
      if (profile?.pocketOptionSsid) ssid = getDecryptedSSID(profile);
      if (!ssid) ssid = await getGlobalSsid();

      if (ssid) {
        console.log(`[BotRunner] Tentative de reconnexion express pour ${this.asset}...`);
        await connectPocketOption(this.userId, ssid, isDemo);
      }
    } catch (err) {
      console.error(`[BotRunner] Échec reconnexion express:`, err);
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

// ── Étape 2.3 : Mutex anti-duplication démarrage bot ──────────────────────────
// Empêche 2 bots de démarrer si bridge:connected se déclenche 2× rapidement
const botStartMutex = new Map<number, number>(); // userId → timestamp expiry
const BOT_START_MUTEX_TTL = 5000; // 5s

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
  // ── Guard: mutex actif pour cet utilisateur → on retourne le runner existant ──
  const mutexExpiry = botStartMutex.get(opts.userId);
  if (mutexExpiry && Date.now() < mutexExpiry) {
    const existing = activeRunners.get(opts.userId);
    if (existing) {
      console.log(`[BotRunner] Mutex actif — démarrage dupliqué ignoré pour user ${opts.userId}`);
      return existing;
    }
  }

  // Activer le mutex pour 5s
  botStartMutex.set(opts.userId, Date.now() + BOT_START_MUTEX_TTL);

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
