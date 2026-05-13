import { NextResponse } from "next/server";
import { db } from "@/db";
import { signals, trades, systemLogs } from "@/db/schema";
import { sql } from "drizzle-orm";

export async function GET(req: Request) {
  try {
    // Basic API Key protection for CRON
    const { searchParams } = new URL(req.url);
    const key = searchParams.get("key");

    // Replace with a secure key in production or use environment variable
    if (key !== "purge-cron-secret-123") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    // Delete old signals
    const signalsResult = await db.execute(
      sql`DELETE FROM ${signals} WHERE ${signals.createdAt} < ${sevenDaysAgo}`
    );

    // Delete old logs (if systemLogs exists, adjust if needed)
    // We wrap in try-catch in case the table doesn't exist or is named differently
    let logsResult = { rowCount: 0 };
    try {
      logsResult = await db.execute(
        sql`DELETE FROM ${systemLogs} WHERE ${systemLogs.timestamp} < ${sevenDaysAgo}`
      );
    } catch (e) {
      console.log("systemLogs purge skipped (table might not exist)");
    }

    // Notice: We do NOT delete trades, because trades are important for accounting and history.
    // If you want to delete demo trades later, we can add it.

    return NextResponse.json({
      success: true,
      message: "Purge automatique réussie",
      deleted: {
        signals: signalsResult.rowCount || 0,
        logs: logsResult.rowCount || 0
      },
      timestamp: new Date().toISOString()
    });

  } catch (error: any) {
    console.error("[Purge API] Error:", error);
    return NextResponse.json(
      { success: false, error: "Erreur lors de la purge" },
      { status: 500 }
    );
  }
}
