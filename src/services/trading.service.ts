import { db } from "@/db";
import { signals, trades, users, platformSettings } from "@/db/schema";
import { eq, desc, and, sql } from "drizzle-orm";
import {
  generateSignal,
  type Timeframe,
  type Signal,
  type Candle,
  TIMEFRAMES,
} from "@/lib/trading";
import { candleCache } from "@/lib/candle-cache";
import { getDecryptedSSID } from "@/services/auth.service";
import { encryptSSID, decryptSSID as decryptAuthSSID } from "@/lib/auth";
import { PocketOptionClient } from "@/lib/pocketoption/client";
import { externalDataService } from "@/services/external-data.service";

// Re-export for convenience
export const decryptSSID = decryptAuthSSID;
import { preFetchCookies, getBestHost } from "@/lib/pocketoption/connection";

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
  // Minimum candles for indicators: Bollinger(20) and Stoch(14) need at least 20
  const minRequired = 20;

  if (!TIMEFRAMES.includes(selectedTimeframe as Timeframe)) {
    return { signal: null, saved: null, error: "Timeframe invalide" };
  }

  // Use real candle data from CandleCache or External API
  let candles: Candle[] = [];
  const isOTC = selectedAsset.toUpperCase().includes("(OTC)");

  if (!isOTC) {
    // Try external API for regular assets to bypass PO history issues
    candles = await externalDataService.getExternalCandles(selectedAsset, selectedTimeframe as Timeframe, 100);
    if (candles.length > 0) {
      // Sync to cache for consistency
      candleCache.seedCandles(selectedAsset, parseTimeframe(selectedTimeframe), candles.map(c => ({
        ...c,
        asset: selectedAsset
      })));
    }
  }

  if (candles.length === 0) {
    candles = candleCache.getCandlesForTimeframe(
      selectedAsset,
      selectedTimeframe as Timeframe,
      100
    );
  }

  // If cache is empty and not external, fetch historical candles directly from PocketOption
  if (candles.length < minRequired) {
    const client = activeConnections.get(userId);
    if (client && client.isConnected) {
      console.log(`[Signal] Cache low (${candles.length}/${minRequired}), forcing historical fetch for ${selectedAsset}...`);
      try {
        const tfToSeconds = (tf: string): number => {
          if (tf.endsWith("s")) return parseInt(tf);
          if (tf.endsWith("m")) return parseInt(tf) * 60;
          return 60;
        };
        const sizeSeconds = tfToSeconds(selectedTimeframe);
        
        // Force a subscription change first to wake up the stream
        client.changeSymbol(selectedAsset, sizeSeconds);
        await new Promise(r => setTimeout(r, 1500));

        const historicalCandles = await client.requestCandleHistory(
          selectedAsset,
          sizeSeconds,
          200
        );
        if (historicalCandles.length > 0) {
          candleCache.seedCandles(selectedAsset, sizeSeconds, historicalCandles);
          candles = candleCache.getCandlesForTimeframe(
            selectedAsset,
            selectedTimeframe as Timeframe,
            100
          );
        }
      } catch (err) {
        console.error("[Signal] Failed to fetch candle history:", err);
      }
    }
  }

  if (candles.length < minRequired) {
    return { 
      signal: null, 
      saved: null, 
      error: "Le bot n'a pas encore accumulé assez de données pour cet actif. Veuillez démarrer le bot dans la page 'Automatique' et attendre 10-15 secondes que l'historique se charge." 
    };
  }

  const signal = generateSignal(
    candles,
    selectedAsset,
    selectedTimeframe as Timeframe
  );

  if (!signal) {
    return { signal: null, saved: null, error: "Pas assez de données pour générer un signal" };
  }

  const [savedSignal] = await db
    .insert(signals)
    .values({
      userId,
      asset: signal.asset,
      direction: signal.direction,
      timeframe: signal.timeframe,
      confidence: signal.confidence_score.toFixed(2),
      // Legacy indicators
      rsi: signal.indicators.rsi.toFixed(4),
      macd: signal.indicators.macd.toFixed(8),
      ema: signal.indicators.ema9.toFixed(8),
      bollinger: {
        upper: signal.bollinger.upper,
        middle: signal.bollinger.middle,
        lower: signal.bollinger.lower,
      },
      stochastic: signal.stochastic.k_value.toFixed(4),
      // Strategy indicators
      ema20: signal.indicators.ema20.toFixed(8),
      ema50: signal.indicators.ema50.toFixed(8),
      stochK: signal.stochastic.k_value.toFixed(4),
      stochD: signal.stochastic.d_value.toFixed(4),
      lowFractal: false,
      highFractal: false,
      dojiFiltered: false,
      multiTimeframeConfirmation: {},
      // Scoring system indicators
      supportLevel: null,
      resistanceLevel: null,
      nearSupport: signal.bollinger.price_position === "near_lower",
      nearResistance: signal.bollinger.price_position === "near_upper",
      marketStructure: "NEUTRAL",
      structureBreak: "NONE",
      signalScore: signal.indicators.signalScore?.toFixed(4) || null,
      bollingerPercentB: null,
      bollingerWidth: null,
      indicatorScores: signal.indicators.indicatorScores || null,
      diagnostic: signal.reason,
      isActive: true,
    })
    .returning();

  return { signal, saved: savedSignal };
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
      // Fallback to simulation only for DEMO mode
      if (tradeMode !== "DEMO") {
        return { trade: null, profit: 0, error: "Erreur d'exécution sur PocketOption" };
      }
      // DEMO fallback simulation
      const isWin = Math.random() < 0.62;
      result = isWin ? "WIN" : "LOSS";
      profit = isWin ? params.amount * 0.85 : -params.amount;
    }
  } else if (tradeMode === "LIVE") {
    return { trade: null, profit: 0, error: "Bot PocketOption non connecté. Démarrez le bot d'abord." };
  } else {
    // DEMO mode without PO connection - simulation
    const isWin = Math.random() < 0.62;
    result = isWin ? "WIN" : "LOSS";
    profit = isWin ? params.amount * 0.85 : -params.amount;
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

export async function connectPocketOption(
  userId: number,
  ssid: string,
  isDemo: boolean = true
): Promise<{ success: boolean; error?: string; ssidExpired?: boolean }> {
  // Disconnect existing
  const existing = activeConnections.get(userId);
  if (existing) {
    try { existing.disconnect(); } catch {}
  }

  // Pre-fetch cookies from PocketOption site for anti-detection
  const host = isDemo ? "demo-api-eu.po.market" : "api-eu.po.market";
  console.log(`[Trading] Pre-fetching cookies from ${host}...`);
  const { cookies } = await preFetchCookies(host);

  const client = new PocketOptionClient(ssid, cookies);

  // Register SSID expiration callback BEFORE connecting
  client.onSsidExpired(() => {
    console.log(`[Trading] SSID expired for user ${userId}, updating DB and pausing bot`);
    updateSsidStatus(userId, "EXPIRED").catch(() => {});
    activeConnections.delete(userId);
    // Pause bot runner if active
    const { getBotRunner } = require("@/services/bot-runner");
    const runner = getBotRunner(userId);
    if (runner) {
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
  }
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

  const client = new PocketOptionClient(ssid, cookies);

  // Register SSID expiration callback
  client.onSsidExpired(() => {
    console.log(`[Trading] Shared SSID expired, pausing all ${sharedClientUsers.size} users`);
    const { getBotRunner } = require("@/services/bot-runner");
    for (const uid of sharedClientUsers) {
      updateSsidStatus(uid, "EXPIRED").catch(() => {});
      const runner = getBotRunner(uid);
      if (runner) runner.pause("SSID_EXPIRED");
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
