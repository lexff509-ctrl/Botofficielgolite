import { NextRequest, NextResponse } from "next/server";
import { handleApiError } from "@/lib/auth";
import { botActionSchema } from "@/lib/validation";
import { getUserFromRequest } from "@/lib/auth";
import { db } from "@/db";
import { botSessions, users } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import { encryptSSID, decryptSSID } from "@/lib/auth";
import { connectPocketOption, disconnectPocketOption } from "@/services/trading.service";
import { startBotRunner, stopBotRunner, getBotRunner, isBotRunning, getAllRunnersStatus } from "@/services/bot-runner";
import { hasActiveSubscription } from "@/services/payment.service";
import { TIMEFRAMES, type Timeframe } from "@/lib/trading";

export async function GET(req: NextRequest) {
  try {
    const payload = getUserFromRequest(req);
    if (!payload) {
      return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
    }

    const sessions = await db
      .select()
      .from(botSessions)
      .where(eq(botSessions.userId, payload.userId))
      .orderBy(desc(botSessions.startedAt))
      .limit(10);

    const activeSession = sessions.find((s) => s.isRunning);

    // Include BotRunner status if running
    const runnerStatus = getBotRunner(payload.userId)?.getStatus() || null;

    return NextResponse.json({
      sessions,
      activeSession: activeSession || null,
      runnerStatus,
    });
  } catch (error) {
    return handleApiError(error, "Bot GET");
  }
}

export async function POST(req: NextRequest) {
  try {
    const payload = getUserFromRequest(req);
    if (!payload) {
      return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
    }

    const body = await req.json();
    const parsed = botActionSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 }
      );
    }

    const { action, mode, botType, ssid, asset, timeframe, tradeAmount } = parsed.data;

    // Check subscription
    const hasAccess = await hasActiveSubscription(payload.userId);
    if (!hasAccess) {
      return NextResponse.json(
        { error: "Abonnement actif requis pour utiliser le bot" },
        { status: 403 }
      );
    }

    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, payload.userId));

    if (action === "START") {
      // Validate timeframe
      const selectedTimeframe = timeframe || "1m";
      if (!TIMEFRAMES.includes(selectedTimeframe as Timeframe)) {
        return NextResponse.json(
          { error: "Timeframe invalide" },
          { status: 400 }
        );
      }

      const selectedAsset = asset || "EUR/USD";
      const selectedBotType = botType || "signal";
      const selectedMode = mode || user.tradeMode;

      // Determine trade amount: provided > user default for mode > 1
      const defaultAmount = selectedMode === "DEMO"
        ? parseFloat(user.demoTradeAmount || "1")
        : parseFloat(user.liveTradeAmount || "1");
      const selectedTradeAmount = tradeAmount || defaultAmount;

      // Stop existing BotRunner
      stopBotRunner(payload.userId);

      // Stop existing sessions in DB
      await db
        .update(botSessions)
        .set({ isRunning: false, stoppedAt: new Date() })
        .where(eq(botSessions.userId, payload.userId));

      // Disconnect existing PocketOption session
      disconnectPocketOption(payload.userId);

      // Get SSID: provided > saved > env > empty
      const rawSsid =
        ssid ||
        decryptSSID(user.pocketOptionSsid) ||
        process.env.POCKET_OPTION_SSID ||
        "";

      const encryptedSsid = rawSsid ? encryptSSID(rawSsid) : "";

      // Connect to PocketOption (needed for real candle data in both DEMO and LIVE)
      if (rawSsid) {
        const connectResult = await connectPocketOption(payload.userId, rawSsid);
        if (!connectResult.success) {
          return NextResponse.json(
            { error: `Connexion PocketOption échouée: ${connectResult.error}` },
            { status: 400 }
          );
        }
      }

      const [session] = await db
        .insert(botSessions)
        .values({
          userId: payload.userId,
          sessionToken: encryptedSsid,
          isRunning: true,
          mode: selectedMode,
          botType: selectedBotType,
          asset: selectedAsset,
          timeframe: selectedTimeframe,
          tradeAmount: String(selectedTradeAmount),
          totalTrades: 0,
          wins: 0,
          losses: 0,
          totalProfit: "0",
        })
        .returning();

      // Save SSID if provided
      if (ssid) {
        await db
          .update(users)
          .set({ pocketOptionSsid: encryptSSID(ssid) })
          .where(eq(users.id, payload.userId));
      }

      // Start the BotRunner background loop
      const runner = startBotRunner({
        userId: payload.userId,
        botType: selectedBotType as "signal" | "auto",
        asset: selectedAsset,
        timeframe: selectedTimeframe as Timeframe,
        mode: selectedMode as "DEMO" | "LIVE",
        tradeAmount: selectedTradeAmount,
      });

      return NextResponse.json({
        success: true,
        session,
        action: "STARTED",
        runnerStatus: runner.getStatus(),
      });
    } else if (action === "STOP") {
      // Stop the BotRunner
      stopBotRunner(payload.userId);

      // Disconnect PocketOption
      disconnectPocketOption(payload.userId);

      await db
        .update(botSessions)
        .set({ isRunning: false, stoppedAt: new Date() })
        .where(eq(botSessions.userId, payload.userId));

      return NextResponse.json({ success: true, action: "STOPPED" });
    }

    return NextResponse.json({ error: "Action invalide" }, { status: 400 });
  } catch (error) {
    return handleApiError(error, "Bot POST");
  }
}
