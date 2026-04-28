import { NextResponse } from "next/server";
import { db } from "@/db";
import { sql } from "drizzle-orm";
import { getAllRunnersStatus } from "@/services/bot-runner";
import { candleCache } from "@/lib/candle-cache";

export async function GET() {
  const checks: Record<string, "ok" | "error"> = {};
  let allOk = true;

  // Database check
  try {
    await db.execute(sql`SELECT 1`);
    checks.database = "ok";
  } catch {
    checks.database = "error";
    allOk = false;
  }

  // BotRunner status
  try {
    const runners = getAllRunnersStatus();
    checks.runners = "ok";
    const runnerInfo = runners.map((r) => ({
      userId: r.userId,
      botType: r.botType,
      asset: r.asset,
      timeframe: r.timeframe,
      mode: r.mode,
      running: r.running,
      paused: r.paused,
      signalsGenerated: r.signalsGenerated,
      tradesExecuted: r.tradesExecuted,
      consecutiveErrors: r.consecutiveErrors,
    }));

    return NextResponse.json({
      status: allOk ? "ok" : "degraded",
      timestamp: new Date().toISOString(),
      checks,
      runners: runnerInfo,
      candleCache: candleCache.getStatus(),
    });
  } catch {
    checks.runners = "error";
    allOk = false;
  }

  return NextResponse.json({
    status: allOk ? "ok" : "degraded",
    timestamp: new Date().toISOString(),
    checks,
    candleCache: candleCache.getStatus(),
  });
}
