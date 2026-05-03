import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest, handleApiError } from "@/lib/auth";
import { db } from "@/db";
import { trades } from "@/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { getPocketOptionClient } from "@/services/trading.service";
import { hasActiveSubscription } from "@/services/payment.service";

// GET: Get backtest stats from DB trades
export async function GET(req: NextRequest) {
  try {
    const payload = getUserFromRequest(req);
    if (!payload) {
      return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const mode = searchParams.get("mode") as "DEMO" | "LIVE" | null;
    const asset = searchParams.get("asset");

    const conditions = [eq(trades.userId, payload.userId)];
    if (mode && ["DEMO", "LIVE"].includes(mode)) {
      conditions.push(eq(trades.mode, mode));
    }

    const allTrades = await db
      .select()
      .from(trades)
      .where(and(...conditions))
      .orderBy(trades.openedAt);

    // Filter by asset if provided
    const filteredTrades = asset
      ? allTrades.filter((t) => t.asset === asset)
      : allTrades;

    const totalTrades = filteredTrades.length;
    const wins = filteredTrades.filter((t) => t.result === "WIN").length;
    const losses = filteredTrades.filter((t) => t.result === "LOSS").length;
    const winRate = totalTrades > 0 ? (wins / totalTrades) * 100 : 0;

    const totalProfit = filteredTrades.reduce(
      (acc, t) => acc + parseFloat(t.profit || "0"),
      0
    );
    const grossProfit = filteredTrades
      .filter((t) => t.result === "WIN")
      .reduce((acc, t) => acc + parseFloat(t.profit || "0"), 0);
    const grossLoss = Math.abs(
      filteredTrades
        .filter((t) => t.result === "LOSS")
        .reduce((acc, t) => acc + parseFloat(t.profit || "0"), 0)
    );
    const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit;

    // Check if PocketOption is connected and get real balance
    const poClient = getPocketOptionClient(payload.userId);
    const poConnected = poClient?.isConnected || false;
    let initialEquity = 10000;

    if (poClient && poClient.isConnected && poClient.balance) {
      // The client balance object has { balance: number, isDemo: number }
      // where isDemo is 1 for demo account and 0 for live account
      const isBalanceDemo = poClient.balance.isDemo === 1;
      const isRequestDemo = mode === "DEMO";

      if (isBalanceDemo === isRequestDemo) {
        const currentRealBalance = poClient.balance.balance;
        // Calculate initial equity based on current balance minus cumulative profits of trades shown
        const totalProfitShown = filteredTrades.reduce((acc, t) => acc + parseFloat(t.profit || "0"), 0);
        initialEquity = currentRealBalance - totalProfitShown;
      }
    }

    let equity = initialEquity;
    const equityCurve = filteredTrades.map((t) => {
      equity += parseFloat(t.profit || "0");
      return {
        date: t.openedAt,
        equity: parseFloat(equity.toFixed(2)),
        asset: t.asset,
        direction: t.direction,
        result: t.result,
        profit: parseFloat(t.profit || "0"),
        amount: t.amount,
      };
    });

    return NextResponse.json({
      stats: {
        totalTrades,
        wins,
        losses,
        winRate: parseFloat(winRate.toFixed(2)),
        totalProfit: parseFloat(totalProfit.toFixed(2)),
        grossProfit: parseFloat(grossProfit.toFixed(2)),
        grossLoss: parseFloat(grossLoss.toFixed(2)),
        profitFactor: parseFloat(profitFactor.toFixed(2)),
      },
      equityCurve,
      trades: filteredTrades.slice(-50).reverse(),
      poConnected,
      initialEquity: parseFloat(initialEquity.toFixed(2)),
    });
  } catch (error) {
    return handleApiError(error, "Backtest GET");
  }
}

// POST: Import trades from PocketOption account
export async function POST(req: NextRequest) {
  try {
    const payload = getUserFromRequest(req);
    if (!payload) {
      return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
    }

    const hasAccess = await hasActiveSubscription(payload.userId);
    if (!hasAccess) {
      return NextResponse.json(
        { error: "Abonnement actif requis" },
        { status: 403 }
      );
    }

    const client = getPocketOptionClient(payload.userId);
    if (!client || !client.isConnected) {
      return NextResponse.json(
        { error: "PocketOption non connecté. Démarrez le bot d'abord." },
        { status: 400 }
      );
    }

    const body = await req.json().catch(() => ({}));
    const limit = body.limit || 100;

    // Fetch trade history from PocketOption
    const poTrades = await client.getTradeHistory();

    if (poTrades.length === 0) {
      return NextResponse.json({
        imported: 0,
        message: "Aucun trade trouvé sur le compte PocketOption",
      });
    }

    // Get existing PO trade IDs to avoid duplicates
    const existingTrades = await db
      .select({ poTradeId: trades.poTradeId })
      .from(trades)
      .where(eq(trades.userId, payload.userId));
    const existingIds = new Set(existingTrades.map((t) => t.poTradeId));

    // Insert new trades (dedup by poTradeId)
    let imported = 0;
    for (const poTrade of poTrades) {
      if (existingIds.has(poTrade.id)) continue;

      await db.insert(trades).values({
        userId: payload.userId,
        mode: "LIVE",
        asset: poTrade.asset,
        direction: poTrade.direction,
        amount: String(poTrade.amount),
        openPrice: poTrade.openPrice ? String(poTrade.openPrice) : null,
        closePrice: poTrade.closePrice ? String(poTrade.closePrice) : null,
        timeframe: "1m",
        result: poTrade.result,
        profit: poTrade.profit.toFixed(2),
        isAutomatic: false,
        poTradeId: poTrade.id,
        openedAt: poTrade.openTime ? new Date(poTrade.openTime * 1000) : new Date(),
        closedAt: poTrade.closeTime ? new Date(poTrade.closeTime * 1000) : new Date(),
      });
      existingIds.add(poTrade.id);
      imported++;
    }

    return NextResponse.json({
      imported,
      total: poTrades.length,
      message: `${imported} nouveaux trades importés sur ${poTrades.length} trouvés`,
    });
  } catch (error) {
    return handleApiError(error, "Backtest POST");
  }
}
