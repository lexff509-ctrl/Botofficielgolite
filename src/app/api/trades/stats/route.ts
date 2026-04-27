import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { trades } from "@/db/schema";
import { getUserFromRequest, handleApiError } from "@/lib/auth";
import { eq, and } from "drizzle-orm";

export async function GET(req: NextRequest) {
  try {
    const payload = getUserFromRequest(req);
    if (!payload) {
      return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const mode = searchParams.get("mode") as "DEMO" | "LIVE" | null;

    const conditions = [eq(trades.userId, payload.userId)];
    if (mode && ["DEMO", "LIVE"].includes(mode)) {
      conditions.push(eq(trades.mode, mode));
    }

    const allTrades = await db
      .select()
      .from(trades)
      .where(and(...conditions))
      .orderBy(trades.openedAt);

    const totalTrades = allTrades.length;
    const wins = allTrades.filter((t) => t.result === "WIN").length;
    const losses = allTrades.filter((t) => t.result === "LOSS").length;
    const winRate = totalTrades > 0 ? (wins / totalTrades) * 100 : 0;

    const totalProfit = allTrades.reduce(
      (acc, t) => acc + parseFloat(t.profit || "0"),
      0
    );

    const grossProfit = allTrades
      .filter((t) => t.result === "WIN")
      .reduce((acc, t) => acc + parseFloat(t.profit || "0"), 0);

    const grossLoss = Math.abs(
      allTrades
        .filter((t) => t.result === "LOSS")
        .reduce((acc, t) => acc + parseFloat(t.profit || "0"), 0)
    );

    const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit;

    let equity = 10000;
    const equityCurve = allTrades.map((t) => {
      equity += parseFloat(t.profit || "0");
      return {
        date: t.openedAt,
        equity: parseFloat(equity.toFixed(2)),
        trade: t.direction,
        result: t.result,
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
    });
  } catch (error) {
    return handleApiError(error, "Stats");
  }
}
