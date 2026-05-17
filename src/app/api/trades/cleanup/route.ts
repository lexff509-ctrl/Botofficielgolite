import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { trades } from "@/db/schema";
import { eq, and, lt } from "drizzle-orm";
import { getUserFromRequest, handleApiError } from "@/lib/auth";

const ORPHAN_TRADE_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

export async function POST(req: NextRequest) {
  try {
    const payload = getUserFromRequest(req);
    if (!payload) {
      return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
    }

    const cutoffTime = new Date(Date.now() - ORPHAN_TRADE_TIMEOUT_MS);

    // Find all PENDING trades older than 10 minutes for this user
    const orphanTrades = await db
      .select()
      .from(trades)
      .where(
        and(
          eq(trades.userId, payload.userId),
          eq(trades.result, "PENDING"),
          lt(trades.openedAt, cutoffTime)
        )
      );

    if (orphanTrades.length === 0) {
      return NextResponse.json({
        message: "Aucun trade orphelin détecté",
        cleaned: 0,
      });
    }

    // Mark orphan trades as LOSS (conservative approach)
    await db
      .update(trades)
      .set({
        result: "LOSS",
        profit: "0",
        closedAt: new Date(),
      })
      .where(
        and(
          eq(trades.userId, payload.userId),
          eq(trades.result, "PENDING"),
          lt(trades.openedAt, cutoffTime)
        )
      );

    console.log(
      `[Cleanup] Marked ${orphanTrades.length} orphan trades as LOSS for user ${payload.userId}`
    );

    return NextResponse.json({
      message: `${orphanTrades.length} trade(s) orphelin(s) nettoyé(s)`,
      cleaned: orphanTrades.length,
      trades: orphanTrades.map((t) => ({
        id: t.id,
        asset: t.asset,
        direction: t.direction,
        amount: t.amount,
        openedAt: t.openedAt,
      })),
    });
  } catch (error) {
    return handleApiError(error, "Trades Cleanup POST");
  }
}
