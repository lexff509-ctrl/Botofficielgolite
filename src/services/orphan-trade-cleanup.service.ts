import { db } from "@/db";
import { trades } from "@/db/schema";
import { eq, and, lt } from "drizzle-orm";

const ORPHAN_TRADE_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // Run every 5 minutes

let cleanupIntervalHandle: ReturnType<typeof setInterval> | null = null;

export function startAutomaticCleanup(): void {
  if (cleanupIntervalHandle) {
    console.log("[OrphanTradeCleanup] Cleanup already running");
    return;
  }

  console.log("[OrphanTradeCleanup] Starting automatic orphan trade cleanup service");

  cleanupIntervalHandle = setInterval(async () => {
    try {
      await cleanupOrphanTrades();
    } catch (error) {
      console.error("[OrphanTradeCleanup] Exception during cleanup:", error);
    }
  }, CLEANUP_INTERVAL_MS);
}

export function stopAutomaticCleanup(): void {
  if (cleanupIntervalHandle) {
    clearInterval(cleanupIntervalHandle);
    cleanupIntervalHandle = null;
    console.log("[OrphanTradeCleanup] Stopped automatic cleanup service");
  }
}

export async function cleanupOrphanTrades(): Promise<{
  cleaned: number;
  trades: Array<{ id: number; userId: number; asset: string }>;
}> {
  try {
    const cutoffTime = new Date(Date.now() - ORPHAN_TRADE_TIMEOUT_MS);

    // Find all PENDING trades older than 10 minutes across ALL users
    const orphanTrades = await db
      .select()
      .from(trades)
      .where(
        and(
          eq(trades.result, "PENDING"),
          lt(trades.openedAt, cutoffTime)
        )
      );

    if (orphanTrades.length === 0) {
      return { cleaned: 0, trades: [] };
    }

    // Mark orphan trades as LOSS (conservative approach)
    // This prevents false PENDING states from blocking trading
    await db
      .update(trades)
      .set({
        result: "LOSS",
        profit: "0",
        closedAt: new Date(),
      })
      .where(
        and(
          eq(trades.result, "PENDING"),
          lt(trades.openedAt, cutoffTime)
        )
      );

    const summary = orphanTrades.map((t) => ({
      id: t.id,
      userId: t.userId,
      asset: t.asset,
    }));

    console.log(
      `[OrphanTradeCleanup] Cleaned ${orphanTrades.length} orphan trades:`,
      summary
    );

    return { cleaned: orphanTrades.length, trades: summary };
  } catch (error) {
    console.error("[OrphanTradeCleanup] Cleanup error:", error);
    return { cleaned: 0, trades: [] };
  }
}
