import { db } from "@/db";
import { signals, trades, users } from "@/db/schema";
import { eq, desc, and, sql } from "drizzle-orm";
import {
  generateSignal,
  type Timeframe,
  type Signal,
  TIMEFRAMES,
} from "@/lib/trading";
import { candleCache } from "@/lib/candle-cache";
import { getDecryptedSSID } from "@/services/auth.service";
import { PocketOptionClient } from "@/lib/pocketoption/client";

// Active PocketOption connections per user
const activeConnections = new Map<number, PocketOptionClient>();

// ============ SIGNALS ============

// ============ ASSETS ============

export const REGULAR_ASSETS = [
  "EUR/USD",
  "GBP/USD",
  "USD/JPY",
  "AUD/USD",
  "USD/CAD",
  "EUR/GBP",
  "BTC/USD",
  "ETH/USD",
];

export const OTC_ASSETS = [
  "EUR/USD (OTC)",
  "GBP/USD (OTC)",
  "USD/JPY (OTC)",
  "AUD/USD (OTC)",
  "BTC/USD (OTC)",
  "ETH/USD (OTC)",
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

  // Use real candle data from CandleCache
  const candles = candleCache.getCandlesForTimeframe(
    selectedAsset,
    selectedTimeframe as Timeframe,
    100
  );

  if (candles.length < 50) {
    return { signal: null, saved: null, error: "Pas assez de données de marché (min 50 bougies requises)" };
  }

  const signal = generateSignal(
    candles,
    selectedAsset,
    selectedTimeframe as Timeframe
  );

  if (!signal) {
    return { signal: null, saved: null, error: "Pas de signal détecté" };
  }

  const [savedSignal] = await db
    .insert(signals)
    .values({
      userId,
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
    })
    .returning();

  return { signal, saved: savedSignal };
}

export async function getRecentSignals(userId: number, limit = 20) {
  return db
    .select()
    .from(signals)
    .where(eq(signals.userId, userId))
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
    .orderBy(desc(trades.openedAt))
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

  // For LIVE mode, execute via PocketOption API
  let result: "WIN" | "LOSS" = "LOSS";
  let profit = -params.amount;

  if (tradeMode === "LIVE") {
    const client = activeConnections.get(userId);
    if (!client || !client.isConnected) {
      return { trade: null, profit: 0, error: "Bot PocketOption non connecté. Démarrez le bot automatique d'abord." };
    }
    try {
      const tradeResult = await client.placeTrade({
        asset: params.asset,
        direction: params.direction,
        amount: params.amount,
        duration: parseTimeframe(params.timeframe),
      });
      result = tradeResult.win ? "WIN" : "LOSS";
      profit = tradeResult.win ? params.amount * 0.85 : -params.amount;
    } catch (err) {
      return { trade: null, profit: 0, error: "Erreur d'exécution sur PocketOption" };
    }
  } else {
    // DEMO simulation: 62% win rate
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
  return activeConnections.get(userId);
}

export async function connectPocketOption(
  userId: number,
  ssid: string,
  isDemo: boolean = true
): Promise<{ success: boolean; error?: string }> {
  // Disconnect existing
  const existing = activeConnections.get(userId);
  if (existing) {
    try { existing.disconnect(); } catch {}
  }

  const client = new PocketOptionClient(ssid);
  try {
    await client.connect(isDemo);
    activeConnections.set(userId, client);
    // Register client with candle cache for real-time data
    candleCache.setClient(client);
    return { success: true };
  } catch (err) {
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
    // Clear candle cache if no more active connections
    if (activeConnections.size === 0) {
      candleCache.clear();
    }
  }
}

// ============ HELPERS ============

function parseTimeframe(tf: string): number {
  if (tf.endsWith("s")) return parseInt(tf);
  if (tf.endsWith("m")) return parseInt(tf) * 60;
  return 60;
}
