import { db } from "@/db";
import { signals, trades, users, platformSettings } from "@/db/schema";
import { eq, desc, and, sql } from "drizzle-orm";
import {
  generateSignal,
  calculateEMA,
  type Timeframe,
  type Signal,
  type Candle,
  TIMEFRAMES,
} from "@/lib/trading";
import { OrchestratorAgent } from "@/core/agents/OrchestratorAgent";
import { candleCache } from "@/lib/candle-cache";
import { getDecryptedSSID } from "@/services/auth.service";
import { encryptSSID, decryptSSID as decryptAuthSSID } from "@/lib/auth";
import { PocketOptionClient } from "@/lib/pocketoption/client";
import { externalDataService } from "@/services/external-data.service";

// Re-export for convenience
export const decryptSSID = decryptAuthSSID;
import { preFetchCookies, getBestHost } from "@/lib/pocketoption/connection";
import { newsService } from "@/services/news.service";
import { aiSentimentService } from "@/services/ai-sentiment.service";

// Lazy getter for BotRunner — avoids circular dependency & ESM require() issues
function getBotRunnerLazy(userId: number): { pause: (reason: string) => void } | null {
  try {
    // Dynamic import-safe: use the module registry directly
    const mod = require("@/services/bot-runner");
    if (mod && typeof mod.getBotRunner === "function") {
      return mod.getBotRunner(userId);
    }
  } catch {
    // Module not loaded yet or circular dep — safe to ignore
  }
  return null;
}


// Active PocketOption connections per user (personal SSID)
const activeConnections = new Map<number, PocketOptionClient>();

// Shared PocketOption client for global SSID (admin-provided)
let sharedClient: PocketOptionClient | null = null;
let sharedSsid: string | null = null;
const sharedClientUsers = new Set<number>();

// ============ SIGNALS ============

// ============ ASSETS ============

export const REGULAR_ASSETS = [
  "EUR/USD", "GBP/USD", "USD/JPY", "AUD/USD",
  "USD/CAD", "EUR/GBP", "BTC/USD", "ETH/USD",
  "USD/CHF", "EUR/JPY", "GBP/JPY", "NZD/USD",
  "EUR/CHF", "AUD/JPY", "CAD/JPY", "EUR/CAD",
];

export const OTC_ASSETS = [
  "EUR/USD (OTC)", "GBP/USD (OTC)", "USD/JPY (OTC)",
  "AUD/USD (OTC)", "BTC/USD (OTC)", "ETH/USD (OTC)",
  "USD/CHF (OTC)", "EUR/JPY (OTC)", "GBP/JPY (OTC)",
  "NZD/USD (OTC)", "EUR/CHF (OTC)", "AUD/JPY (OTC)",
  "CAD/JPY (OTC)", "EUR/CAD (OTC)", "USD/CAD (OTC)",
  "EUR/GBP (OTC)", "AUD/CAD (OTC)", "GBP/CHF (OTC)",
];

export const ALL_ASSETS = [...REGULAR_ASSETS, ...OTC_ASSETS];

export async function generateAndSaveSignal(
  userId: number,
  asset?: string,
  timeframe?: string
): Promise<{ signal: Signal | null; saved: unknown | null; error?: string }> {
  const selectedAsset = asset || ALL_ASSETS[Math.floor(Math.random() * ALL_ASSETS.length)];
  const selectedTimeframe = timeframe || "1m";

  if (!TIMEFRAMES.includes(selectedTimeframe as Timeframe)) {
    return { signal: null, saved: null, error: "Timeframe invalide" };
  }

  // ─── News Filter (Economic Calendar) ──────────────────────────────────────
  const newsCheck = await newsService.isSafeToTrade(selectedAsset);
  if (!newsCheck.safe) {
    console.warn(`[Signal] Blocked by News Filter: ${newsCheck.reason}`);
    return { signal: null, saved: null, error: newsCheck.reason };
  }

  // ─── Data Collection (all sources, best-effort) ───────────────────────────
  let candles: Candle[] = [];
  const isOTC = selectedAsset.toUpperCase().includes("(OTC)");
  const tfSeconds = parseTimeframe(selectedTimeframe);

  // 1) Binance (non-OTC assets only)
  if (!isOTC) {
    candles = await externalDataService.getExternalCandles(selectedAsset, selectedTimeframe as Timeframe, 100);
    if (candles.length > 0) {
      candleCache.seedCandles(selectedAsset, tfSeconds, candles.map(c => ({ ...c, asset: selectedAsset })));
    }
  }

  // 2) PO cache
  if (candles.length === 0) {
    candles = candleCache.getCandlesForTimeframe(selectedAsset, selectedTimeframe as Timeframe, 100);
  }

  // 3) PO live history (OTC or if cache still empty)
  if (candles.length < 20) {
    const client = activeConnections.get(userId);
    if (client && client.isConnected) {
      console.log(`[Signal] Fetching PO history for ${selectedAsset} (${candles.length} candles in cache)...`);
      try {
        client.changeSymbol(selectedAsset, tfSeconds);
        await new Promise(r => setTimeout(r, 1200));
        const hist = await client.requestCandleHistory(selectedAsset, tfSeconds, 200);
        if (hist.length > 0) {
          candleCache.seedCandles(selectedAsset, tfSeconds, hist);
          candles = candleCache.getCandlesForTimeframe(selectedAsset, selectedTimeframe as Timeframe, 100);
        }
      } catch (err) {
        console.error("[Signal] PO history fetch failed:", err);
      }
    }
  }

  // ─── Signal Engine ────────────────────────────────────────────────────────
  // If we have absolutely no data, we cannot generate a meaningful signal
  if (candles.length === 0) {
    console.warn(`[Signal] No candle data at all for ${selectedAsset} — skipping this tick.`);
    return { signal: null, saved: null, error: `Connexion en cours pour ${selectedAsset}. Le signal arrivera dans quelques secondes.` };
  }

  const strategy = await OrchestratorAgent.evaluate(candles as any, selectedAsset, selectedTimeframe, isOTC);

  if (strategy.signal === "WAIT") {
    return { signal: null, saved: null, error: `Marché instable: ${strategy.reason}` };
  }

  // ─── MTF Confirmation (Multi-Timeframe) ──────────────────────────────────
  let mtfStatus = "NEUTRAL";
  if (selectedTimeframe === "1m" || selectedTimeframe === "3m") {
    const higherTf = selectedTimeframe === "1m" ? "5m" : "15m";
    let mtfCandles: Candle[] = [];
    
    if (isOTC) {
      mtfCandles = candleCache.getCandlesForTimeframe(selectedAsset, higherTf as Timeframe, 50);
    } else {
      mtfCandles = await externalDataService.getExternalCandles(selectedAsset, higherTf as Timeframe, 50);
    }

    if (mtfCandles.length >= 30) {
      const mtfStrategy = await OrchestratorAgent.evaluate(mtfCandles as any, selectedAsset, higherTf, isOTC);
      if (mtfStrategy.signal === strategy.signal) {
        mtfStatus = "ALIGNED";
        strategy.score = Math.min(99, strategy.score + 5);
        if (strategy.score >= 80) strategy.confidence = "HIGH";
      } else {
        mtfStatus = "CONTRADICTING";
        strategy.score -= 15;
        strategy.confidence = strategy.score >= 60 ? "MEDIUM" : "LOW";
      }
    }
  }

  // ─── AI Sentiment Analysis (Price Action Validation) ─────────────────────
  let aiReason = "";
  if (strategy.confidence === "HIGH") {
    const aiCheck = await aiSentimentService.validatePriceAction(selectedAsset, selectedTimeframe, strategy.signal as any, candles);
    if (!aiCheck.approved) {
      strategy.confidence = "LOW";
      strategy.score -= 25;
    }
    aiReason = ` | ${aiCheck.reason}`;
  }

  const lastCandle = candles[candles.length - 1];
  const ind = strategy.marketState?.indicators || {} as any;
  const struct = strategy.marketState?.structure || {} as any;
  
  // Dummy data for legacy fields to avoid breaking the frontend
  const dummyBollinger = { signal: "NEUTRAL" as any, upper: ind.bollinger?.upper || 0, middle: ind.bollinger?.middle || 0, lower: ind.bollinger?.lower || 0, price_position: struct.isNearSupport ? "near_lower" : struct.isNearResistance ? "near_upper" : "neutral" };
  const dummyStoch = { signal: "NEUTRAL" as any, k: ind.stochastic?.k || 50, d: ind.stochastic?.d || 50, k_value: ind.stochastic?.k || 50, d_value: ind.stochastic?.d || 50 };

  const signalObj: Signal = {
    signal: strategy.signal,
    confidence: strategy.confidence,
    timeframe: selectedTimeframe as Timeframe,
    timestamp: new Date().toISOString().replace("T", " ").split(".")[0],
    price_current: lastCandle.close,
    asset: selectedAsset,
    bollinger: dummyBollinger as any,
    stochastic: dummyStoch as any,
    reason: `${strategy.reason}${aiReason} (MTF: ${mtfStatus})`,
    action: strategy.confidence === "HIGH" ? "ENTRER MAINTENANT" : strategy.confidence === "MEDIUM" ? "ATTENDRE" : "ÉVITER",
    direction: strategy.signal === "BUY" ? "CALL" : "PUT",
    confidence_score: strategy.score,
    indicators: {
      rsi: ind.rsi || 50,
      macd: ind.macd?.MACD || 0,
      ema9: ind.ema9 || 0,
      bollingerUpper: ind.bollinger?.upper || 0,
      bollingerMiddle: ind.bollinger?.middle || 0,
      bollingerLower: ind.bollinger?.lower || 0,
      stochastic: ind.stochastic?.k || 50,
      stochasticSignal: ind.stochastic?.d || 50,
      ema20: ind.ema21 || 0,
      ema50: ind.ema50 || 0,
      stochK: ind.stochastic?.k || 50,
      stochD: ind.stochastic?.d || 50,
      lowFractal: false,
      highFractal: false,
      dojiRejected: false,
      atr: 0,
      bollingerPercentB: 0,
      bollingerWidth: ind.bollinger?.width || 0,
      supportLevel: struct.support || 0,
      resistanceLevel: struct.resistance || 0,
      nearSupport: struct.isNearSupport || false,
      nearResistance: struct.isNearResistance || false,
      marketStructure: struct.trend || "NEUTRAL",
      structureBreak: "NONE",
      signalScore: strategy.score,
      indicatorScores: {
        bollinger: 0,
        stochastic: 0,
      },
    },
    multiTimeframeConfirmation: {},
    diagnostic: strategy.reason,
  };

  // ─── Persist to DB ────────────────────────────────────────────────────────
  try {
    const [savedSignal] = await db
      .insert(signals)
      .values({
        userId,
        asset: signalObj.asset,
        direction: signalObj.direction,
        timeframe: signalObj.timeframe,
        confidence: signalObj.confidence_score.toFixed(2),
        rsi: signalObj.indicators.rsi.toFixed(4),
        macd: signalObj.indicators.macd.toFixed(8),
        ema: signalObj.indicators.ema9.toFixed(8),
        bollinger: {
          upper: signalObj.bollinger.upper,
          middle: signalObj.bollinger.middle,
          lower: signalObj.bollinger.lower,
        },
        stochastic: (signalObj.stochastic as any).k_value.toFixed(4),
        ema20: signalObj.indicators.ema20.toFixed(8),
        ema50: signalObj.indicators.ema50.toFixed(8),
        stochK: (signalObj.stochastic as any).k_value.toFixed(4),
        stochD: (signalObj.stochastic as any).d_value.toFixed(4),
        lowFractal: false,
        highFractal: false,
        dojiFiltered: false,
        multiTimeframeConfirmation: {},
        supportLevel: struct.support ? String(struct.support) : null,
        resistanceLevel: struct.resistance ? String(struct.resistance) : null,
        nearSupport: signalObj.indicators.nearSupport,
        nearResistance: signalObj.indicators.nearResistance,
        marketStructure: struct.trend || "NEUTRAL",
        structureBreak: "NONE",
        signalScore: (strategy.score / 100).toFixed(4),
        bollingerPercentB: null,
        bollingerWidth: null,
        indicatorScores: signalObj.indicators.indicatorScores,
        diagnostic: strategy.reason,
        isActive: true,
      })
      .returning();
    return { signal: signalObj, saved: savedSignal };
  } catch (dbErr) {
    console.error("[Signal] DB save failed:", dbErr);
    return { signal: signalObj, saved: null };
  }
}


export async function getRecentSignals(userId: number, limit = 20) {
  return db
    .select()
    .from(signals)
    .where(and(eq(signals.userId, userId), eq(signals.isActive, true)))
    .orderBy(desc(signals.createdAt))
    .limit(limit);
}

// ============ TRADES ============

export async function getUserTrades(
  userId: number,
  mode?: string,
  limit = 50
) {
  const conditions = [eq(trades.userId, userId)];
  if (mode && ["DEMO", "LIVE"].includes(mode)) {
    conditions.push(eq(trades.mode, mode as "DEMO" | "LIVE"));
  }
  return db
    .select()
    .from(trades)
    .where(and(...conditions))
    .orderBy(desc(trades.closedAt))
    .limit(limit);
}

export async function getUser(userId: number) {
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  return user;
}

export async function executeTrade(
  userId: number,
  params: {
    asset: string;
    direction: "CALL" | "PUT";
    amount: number;
    timeframe: string;
    openPrice?: number;
    mode?: string;
    isAutomatic?: boolean;
  }
): Promise<{ trade: unknown; profit: number; error?: string }> {
  const user = await getUser(userId);
  if (!user) return { trade: null, profit: 0, error: "Utilisateur introuvable" };

  const tradeMode = params.mode || user.tradeMode;

  // For DEMO mode, check demo balance
  if (tradeMode === "DEMO") {
    const currentBalance = parseFloat(user.demoBalance || "0");
    if (currentBalance < params.amount) {
      return { trade: null, profit: 0, error: "Solde démo insuffisant" };
    }
  }

  let result: "WIN" | "LOSS" = "LOSS";
  let profit = -params.amount;
  let tradeId = "";

  // Try to execute via PocketOption WebSocket (both DEMO and LIVE)
  const client = getPocketOptionClient(userId);
  if (client && client.isConnected) {
    try {
      const tradeResult = await client.placeTrade({
        asset: params.asset,
        direction: params.direction,
        amount: params.amount,
        duration: parseTimeframe(params.timeframe),
      });
      result = tradeResult.win ? "WIN" : "LOSS";
      profit = tradeResult.profit;
      tradeId = tradeResult.tradeId;
    } catch (err) {
      console.error("[Trade] PO execution failed:", err);
      return { trade: null, profit: 0, error: "Erreur d'exécution sur PocketOption: " + (err instanceof Error ? err.message : String(err)) };
    }
  } else {
    return { trade: null, profit: 0, error: "Bot PocketOption non connecté. Veuillez vérifier la connexion du bot." };
  }

  const closePrice = params.openPrice
    ? params.direction === "CALL"
      ? params.openPrice * (1 + (result === "WIN" ? 0.001 : -0.001))
      : params.openPrice * (1 - (result === "WIN" ? 0.001 : -0.001))
    : undefined;

  const [newTrade] = await db
    .insert(trades)
    .values({
      userId,
      mode: tradeMode as "DEMO" | "LIVE",
      asset: params.asset,
      direction: params.direction,
      amount: String(params.amount),
      openPrice: params.openPrice?.toString(),
      closePrice: closePrice?.toString(),
      timeframe: params.timeframe,
      result,
      profit: profit.toFixed(2),
      isAutomatic: params.isAutomatic || false,
      poTradeId: tradeId,
      closedAt: new Date(),
    })
    .returning();

  // Update demo balance
  if (tradeMode === "DEMO") {
    const currentBalance = parseFloat(user.demoBalance || "0");
    const newBalance = currentBalance + profit;
    await db
      .update(users)
      .set({ demoBalance: newBalance.toFixed(2) })
      .where(eq(users.id, userId));
  }

  return { trade: newTrade, profit };
}

export async function getTradeStats(userId: number) {
  const rows = await db
    .select({
      total: sql<number>`count(*)::int`,
      wins: sql<number>`sum(case when ${trades.result} = 'WIN' then 1 else 0 end)::int`,
      losses: sql<number>`sum(case when ${trades.result} = 'LOSS' then 1 else 0 end)::int`,
      totalProfit: sql<string>`coalesce(sum(${trades.profit}), '0')`,
    })
    .from(trades)
    .where(eq(trades.userId, userId));

  const stats = rows[0];
  return {
    total: stats?.total ?? 0,
    wins: stats?.wins ?? 0,
    losses: stats?.losses ?? 0,
    totalProfit: stats?.totalProfit ?? "0",
    winRate: stats?.total ? ((stats.wins / stats.total) * 100).toFixed(1) : "0",
  };
}

// ============ POCKETOPTION CONNECTION ============

export function getPocketOptionClient(userId: number): PocketOptionClient | undefined {
  // Check personal connection first
  const personal = activeConnections.get(userId);
  if (personal) return personal;
  // Fall back to shared client if user is in the shared set
  if (sharedClientUsers.has(userId) && sharedClient) return sharedClient;
  return undefined;
}

export async function updateSsidStatus(
  userId: number,
  status: "VALID" | "EXPIRED" | "UNKNOWN" | "NOT_SET"
): Promise<void> {
  await db
    .update(users)
    .set({ ssidStatus: status, updatedAt: new Date() })
    .where(eq(users.id, userId));
}

export async function getSsidStatus(userId: number): Promise<string> {
  const [user] = await db
    .select({ ssidStatus: users.ssidStatus })
    .from(users)
    .where(eq(users.id, userId));
  return user?.ssidStatus ?? "NOT_SET";
}

const connectionMutexes = new Map<number, Promise<{ success: boolean; error?: string; ssidExpired?: boolean }>>();

export async function connectPocketOption(
  userId: number,
  ssid: string,
  isDemo: boolean = true
): Promise<{ success: boolean; error?: string; ssidExpired?: boolean }> {
  // Return existing promise if already connecting
  if (connectionMutexes.has(userId)) {
    return connectionMutexes.get(userId)!;
  }

  // ── Étape 2.5 : Validation format SSID ──────────────────────────────────────
  if (!isValidSsidFormat(ssid)) {
    console.warn(`[Trading] Rejet d'un SSID au format invalide pour user ${userId}`);
    updateSsidStatus(userId, "EXPIRED").catch(() => {}); // Force invalidation
    return Promise.resolve({
      success: false,
      error: "SSID format invalide",
      ssidExpired: true,
    });
  }

  const connectPromise = async () => {
    // Disconnect existing
    const existing = activeConnections.get(userId);
    if (existing) {
      try { existing.disconnect(); } catch {}
    }

  // Bypass pre-fetching cookies if we already have an SSID to speed up auto-restore
  // We only fetch if absolutely needed or as fallback
  let cookies: string[] = [];
  
  const client = new PocketOptionClient(ssid, isDemo, cookies);

  // Register SSID expiration callback BEFORE connecting
  client.onSsidExpired(() => {
    console.log(`[Trading] SSID expired for user ${userId}, updating DB and pausing bot`);
    updateSsidStatus(userId, "EXPIRED").catch(() => {});
    activeConnections.delete(userId);
    // Pause bot runner if active — use lazy getter to avoid ESM circular dependency
    const runner = getBotRunnerLazy(userId);
    if (runner && typeof runner.pause === "function") {
      runner.pause("SSID_EXPIRED");
    }
  });

    try {
      await client.connect(isDemo);
      activeConnections.set(userId, client);
      candleCache.setClient(client);
      await updateSsidStatus(userId, "VALID");
      return { success: true };
    } catch (err) {
      if (client.isSsidExpired) {
        await updateSsidStatus(userId, "EXPIRED");
        return {
          success: false,
          error: "SSID expiré. Veuillez mettre à jour votre SSID dans votre profil.",
          ssidExpired: true,
        };
      }
      await updateSsidStatus(userId, "UNKNOWN");
      return {
        success: false,
        error: err instanceof Error ? err.message : "Échec de connexion à PocketOption",
      };
    } finally {
      connectionMutexes.delete(userId);
    }
  };

  const promise = connectPromise();
  connectionMutexes.set(userId, promise);
  return promise;
}

export function disconnectPocketOption(userId: number): void {
  const client = activeConnections.get(userId);
  if (client) {
    try { client.disconnect(); } catch {}
    activeConnections.delete(userId);
  }
  // Also check shared client
  disconnectSharedPocketOption(userId);
  // Clear candle cache if no more active connections
  if (activeConnections.size === 0 && !sharedClient) {
    candleCache.clear();
  }
}

// ============ SHARED (GLOBAL) POCKETOPTION CLIENT ============

export async function connectSharedPocketOption(
  userId: number,
  ssid: string,
  isDemo: boolean = true
): Promise<{ success: boolean; error?: string; ssidExpired?: boolean }> {
  // If shared client exists with the same SSID and is connected, reuse it
  if (sharedClient && sharedSsid === ssid && sharedClient.isConnected) {
    sharedClientUsers.add(userId);
    console.log(`[Trading] User ${userId} joined shared PO connection (${sharedClientUsers.size} users)`);
    await updateSsidStatus(userId, "VALID");
    return { success: true };
  }

  // If shared client exists but with different SSID or disconnected, disconnect it
  if (sharedClient) {
    try { sharedClient.disconnect(); } catch {}
    sharedClient = null;
    sharedSsid = null;
  }

  // Auto-discover best reachable host and pre-fetch cookies for shared client
  const host = await getBestHost(isDemo);
  console.log(`[Trading] Using host for shared client: ${host} (demo=${isDemo})`);
  const { cookies } = await preFetchCookies(host);

  const client = new PocketOptionClient(ssid, isDemo, cookies);

  // Register SSID expiration callback
  client.onSsidExpired(() => {
    console.log(`[Trading] Shared SSID expired, pausing all ${sharedClientUsers.size} users`);
    for (const uid of sharedClientUsers) {
      updateSsidStatus(uid, "EXPIRED").catch(() => {});
      const runner = getBotRunnerLazy(uid);
      if (runner && typeof runner.pause === "function") runner.pause("SSID_EXPIRED");
    }
    db.update(platformSettings)
      .set({ value: "EXPIRED", updatedAt: new Date() })
      .where(eq(platformSettings.key, "global_ssid_status"))
      .catch(() => {});
    sharedClient = null;
    sharedSsid = null;
    sharedClientUsers.clear();
  });

  try {
    await client.connect(isDemo);
    sharedClient = client;
    sharedSsid = ssid;
    sharedClientUsers.add(userId);
    candleCache.setClient(client);
    await updateSsidStatus(userId, "VALID");
    // Update global status
    await db.update(platformSettings)
      .set({ value: "VALID", updatedAt: new Date() })
      .where(eq(platformSettings.key, "global_ssid_status"));
    console.log(`[Trading] Shared PO connection established by user ${userId}`);
    return { success: true };
  } catch (err) {
    if (client.isSsidExpired) {
      await updateSsidStatus(userId, "EXPIRED");
      await db.update(platformSettings)
        .set({ value: "EXPIRED", updatedAt: new Date() })
        .where(eq(platformSettings.key, "global_ssid_status"));
      return {
        success: false,
        error: "SSID global expiré. L'admin doit mettre à jour le SSID.",
        ssidExpired: true,
      };
    }
    await updateSsidStatus(userId, "UNKNOWN");
    return {
      success: false,
      error: err instanceof Error ? err.message : "Échec de connexion partagée à PocketOption",
    };
  }
}

export function disconnectSharedPocketOption(userId: number): void {
  if (!sharedClientUsers.has(userId)) return;
  sharedClientUsers.delete(userId);
  console.log(`[Trading] User ${userId} left shared PO connection (${sharedClientUsers.size} users remaining)`);

  // If no more users on shared client, disconnect it
  if (sharedClientUsers.size === 0 && sharedClient) {
    try { sharedClient.disconnect(); } catch {}
    sharedClient = null;
    sharedSsid = null;
  }
}

export function isSharedClientConnected(): boolean {
  return sharedClient !== null && sharedClient.isConnected;
}

export function getSharedClientUserCount(): number {
  return sharedClientUsers.size;
}

export function isUserOnSharedClient(userId: number): boolean {
  return sharedClientUsers.has(userId);
}

// Get the decrypted global SSID from platform_settings
export async function getGlobalSsid(): Promise<string> {
  const [row] = await db
    .select({ value: platformSettings.value })
    .from(platformSettings)
    .where(eq(platformSettings.key, "global_ssid"));
  if (!row) return "";
  return decryptSSID(row.value);
}

// Get the global SSID status from platform_settings
export async function getGlobalSsidStatus(): Promise<string> {
  const [row] = await db
    .select({ value: platformSettings.value })
    .from(platformSettings)
    .where(eq(platformSettings.key, "global_ssid_status"));
  return row?.value || "NOT_SET";
}

// Set the global SSID in platform_settings (encrypted)
export async function setGlobalSsid(ssid: string): Promise<void> {
  const encrypted = encryptSSID(ssid);
  const existing = await db
    .select()
    .from(platformSettings)
    .where(eq(platformSettings.key, "global_ssid"));
  if (existing.length > 0) {
    await db
      .update(platformSettings)
      .set({ value: encrypted, updatedAt: new Date() })
      .where(eq(platformSettings.key, "global_ssid"));
  } else {
    await db.insert(platformSettings).values({ key: "global_ssid", value: encrypted });
  }
  // Upsert status
  const statusExisting = await db
    .select()
    .from(platformSettings)
    .where(eq(platformSettings.key, "global_ssid_status"));
  if (statusExisting.length > 0) {
    await db
      .update(platformSettings)
      .set({ value: "UNKNOWN", updatedAt: new Date() })
      .where(eq(platformSettings.key, "global_ssid_status"));
  } else {
    await db.insert(platformSettings).values({ key: "global_ssid_status", value: "UNKNOWN" });
  }
}

// Clear the global SSID
export async function clearGlobalSsid(): Promise<void> {
  await db.delete(platformSettings).where(eq(platformSettings.key, "global_ssid"));
  await db.delete(platformSettings).where(eq(platformSettings.key, "global_ssid_status"));
  if (sharedClient) {
    try { sharedClient.disconnect(); } catch {}
    sharedClient = null;
    sharedSsid = null;
    sharedClientUsers.clear();
  }
}

// Get default payout rate from platform_settings
export async function getDefaultPayoutRate(): Promise<number> {
  const [row] = await db
    .select({ value: platformSettings.value })
    .from(platformSettings)
    .where(eq(platformSettings.key, "default_payout_rate"));
  if (!row) return 0.92;
  const rate = parseFloat(row.value);
  return isNaN(rate) ? 0.92 : rate;
}

// ============ HELPERS ============

function parseTimeframe(tf: string): number {
  if (tf.endsWith("s")) return parseInt(tf);
  if (tf.endsWith("m")) return parseInt(tf) * 60;
  return 60;
}

export function isValidSsidFormat(ssid: string): boolean {
  if (!ssid || typeof ssid !== "string") return false;
  // PO SSID length is generally large
  if (ssid.length < 20) return false;
  
  // Format classique du bridge: 42["auth",{"session":"...","isDemo":X}]
  if (ssid.startsWith('42["auth"')) return true;
  
  // Format token brut
  if (/^[a-zA-Z0-9]{20,}$/.test(ssid)) return true;
  
  return false;
}
