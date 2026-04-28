// Bootstrap - Recovers active bot sessions on server restart
// Reads all isRunning=true sessions from DB and reconnects them

import { db } from "@/db";
import { botSessions, users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { decryptSSID } from "@/lib/auth";
import { connectPocketOption } from "@/services/trading.service";
import { startBotRunner } from "@/services/bot-runner";
import type { Timeframe } from "@/lib/trading";
import { TIMEFRAMES } from "@/lib/trading";

export async function recoverActiveSessions(): Promise<{
  recovered: number;
  failed: number;
  errors: string[];
}> {
  const errors: string[] = [];
  let recovered = 0;
  let failed = 0;

  try {
    // Find all sessions marked as running
    const activeSessions = await db
      .select()
      .from(botSessions)
      .where(eq(botSessions.isRunning, true));

    if (activeSessions.length === 0) return { recovered: 0, failed: 0, errors: [] };

    for (const session of activeSessions) {
      try {
        // Get user's SSID
        const [user] = await db
          .select()
          .from(users)
          .where(eq(users.id, session.userId));

        if (!user) {
          errors.push(`User ${session.userId} not found`);
          await markSessionStopped(session.id);
          failed++;
          continue;
        }

        const rawSsid =
          decryptSSID(user.pocketOptionSsid) ||
          process.env.POCKET_OPTION_SSID ||
          "";

        // Connect to PocketOption if SSID available
        if (rawSsid) {
          const connectResult = await connectPocketOption(session.userId, rawSsid);
          if (!connectResult.success) {
            errors.push(`User ${session.userId}: PocketOption connection failed - ${connectResult.error}`);
            await markSessionStopped(session.id);
            failed++;
            continue;
          }
        }

        // Validate timeframe
        const tf = session.timeframe || "1m";
        const timeframe = TIMEFRAMES.includes(tf as Timeframe) ? (tf as Timeframe) : "1m";

        // Restart the BotRunner
        startBotRunner({
          userId: session.userId,
          botType: (session.botType as "signal" | "auto") || "signal",
          asset: session.asset || "EUR/USD",
          timeframe,
          mode: (session.mode as "DEMO" | "LIVE") || "DEMO",
        });

        recovered++;
      } catch (err) {
        errors.push(
          `User ${session.userId}: ${err instanceof Error ? err.message : "Unknown error"}`
        );
        await markSessionStopped(session.id);
        failed++;
      }
    }
  } catch (err) {
    errors.push(`Bootstrap query failed: ${err instanceof Error ? err.message : "Unknown error"}`);
  }

  return { recovered, failed, errors };
}

async function markSessionStopped(sessionId: number): Promise<void> {
  try {
    await db
      .update(botSessions)
      .set({ isRunning: false, stoppedAt: new Date() })
      .where(eq(botSessions.id, sessionId));
  } catch {
    // Ignore DB errors during cleanup
  }
}
