import { NextRequest, NextResponse } from "next/server";
import { handleApiError } from "@/lib/auth";
import { botActionSchema } from "@/lib/validation";
import { getUserFromRequest } from "@/lib/auth";
import { db } from "@/db";
import { botSessions, users } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import { encryptSSID, decryptSSID } from "@/lib/auth";
import {
  connectPocketOption,
  disconnectPocketOption,
  connectSharedPocketOption,
  getGlobalSsid,
  getGlobalSsidStatus,
  isUserOnSharedClient,
  getDefaultPayoutRate,
  getPocketOptionClient,
} from "@/services/trading.service";
import { startBotRunner, stopBotRunner, getBotRunner, isBotRunning, getAllRunnersStatus } from "@/services/bot-runner";
import { hasActiveSubscription } from "@/services/payment.service";
import { TIMEFRAMES, type Timeframe } from "@/lib/trading";
import { validateSessionVersion } from "@/services/auth.service";

export async function GET(req: NextRequest) {
  try {
    const payload = getUserFromRequest(req);
    if (!payload) {
      return NextResponse.json({ error: "Non authentifie" }, { status: 401 });
    }

    // Single-device session check
    const validSession = await validateSessionVersion(payload.userId, payload.sessionVersion ?? 0);
    if (!validSession) {
      return NextResponse.json({ error: "Session expiree", sessionExpired: true }, { status: 401 });
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

    // Include SSID availability info for the UI
    const globalSsidStatus = await getGlobalSsidStatus();
    const onSharedClient = isUserOnSharedClient(payload.userId);

    // Get real balance if connected
    let realBalance: { demo: number; live: number } | null = null;
    const client = getPocketOptionClient(payload.userId);
    if (client && client.isConnected && client.balance) {
      // The client balance object has { balance: number, isDemo: number }
      const isDemo = client.balance.isDemo === 1;
      realBalance = {
        demo: isDemo ? client.balance.balance : 0,
        live: !isDemo ? client.balance.balance : 0,
      };
    } else {
      realBalance = null;
    }

    return NextResponse.json({
      sessions,
      activeSession: activeSession || null,
      runnerStatus,
      realBalance,
      ssidInfo: {
        hasPersonalSsid: !!activeSession?.useGlobalSsid ? false : true,
        globalSsidAvailable: globalSsidStatus === "VALID",
        globalSsidStatus,
        onSharedClient,
      },
    });
  } catch (error) {
    return handleApiError(error, "Bot GET");
  }
}

export async function POST(req: NextRequest) {
  try {
    const payload = getUserFromRequest(req);
    if (!payload) {
      return NextResponse.json({ error: "Non authentifie" }, { status: 401 });
    }

    // Single-device session check
    const validSession = await validateSessionVersion(payload.userId, payload.sessionVersion ?? 0);
    if (!validSession) {
      return NextResponse.json({ error: "Session expiree", sessionExpired: true }, { status: 401 });
    }

    const body = await req.json();
    const parsed = botActionSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 }
      );
    }

    const {
      action, mode, botType, ssid, asset, timeframe, tradeAmount,
      confidenceMode, profitTarget, lossLimit,
      martingaleEnabled, compoundEnabled, compoundTradesTarget, compoundPayoutRate,
    } = parsed.data;

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

    // ============ RESET_COMPOUND ACTION ============
    if (action === "RESET_COMPOUND") {
      const runner = getBotRunner(payload.userId);
      if (!runner) {
        return NextResponse.json({ error: "Aucun bot actif" }, { status: 400 });
      }
      runner.resetCompound();
      return NextResponse.json({
        success: true,
        action: "COMPOUND_RESET",
        runnerStatus: runner.getStatus(),
      });
    }

    // ============ START ACTION ============
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

      // Resolve SSID: provided > saved > global SSID > env > empty
      let rawSsid =
        ssid ||
        decryptSSID(user.pocketOptionSsid) ||
        "";
      let useGlobalSsid = false;

      // If no personal SSID, try global SSID from platform_settings
      if (!rawSsid) {
        const globalSsid = await getGlobalSsid();
        if (globalSsid) {
          rawSsid = globalSsid;
          useGlobalSsid = true;
        }
      }

      // Last resort: try env variable
      if (!rawSsid) {
        rawSsid = process.env.POCKET_OPTION_SSID || "";
      }

      // SSID is REQUIRED
      if (!rawSsid) {
        return NextResponse.json(
          { error: "Aucun SSID disponible. Ajoutez votre SSID dans votre profil ou demandez a l'admin de configurer le SSID global.", ssidMissing: true },
          { status: 400 }
        );
      }

      const encryptedSsid = encryptSSID(rawSsid);

      // Pre-check: skip connection attempt if personal SSID is already known expired
      if (!useGlobalSsid && user.ssidStatus === "EXPIRED" && !ssid) {
        return NextResponse.json(
          { error: "SSID expire. Veuillez mettre a jour votre SSID dans votre profil.", ssidExpired: true },
          { status: 400 }
        );
      }

      // Connect to PocketOption (non-blocking: start in background, return immediately)
      const isDemoConnection = selectedMode === "DEMO";

      // Start connection in background - don't await it here
      const connectPromise = useGlobalSsid
        ? connectSharedPocketOption(payload.userId, rawSsid, isDemoConnection)
        : connectPocketOption(payload.userId, rawSsid, isDemoConnection);

      // Connect in background and handle errors
      connectPromise.then((connectResult) => {
        if (!connectResult.success) {
          console.error(`[Bot] Connection failed for user ${payload.userId}: ${connectResult.error}`);
          // Stop the runner if connection failed
          const runner = getBotRunner(payload.userId);
          if (runner) {
            runner.pause(connectResult.error || "Connection failed");
          }
        } else {
          console.log(`[Bot] Connection established for user ${payload.userId}`);
        }
      }).catch((err) => {
        console.error(`[Bot] Connection error for user ${payload.userId}:`, err);
        const runner = getBotRunner(payload.userId);
        if (runner) {
          runner.pause("Connection error");
        }
      });

      // Get payout rate: provided > platform default > 0.92
      const platformPayoutRate = await getDefaultPayoutRate();
      const selectedPayoutRate = compoundPayoutRate || platformPayoutRate;

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
          martingaleEnabled: martingaleEnabled || false,
          compoundEnabled: compoundEnabled || false,
          compoundTradesTarget: compoundTradesTarget || null,
          compoundTradesTaken: 0,
          compoundCurrentAmount: compoundEnabled ? String(selectedTradeAmount) : null,
          compoundInitialAmount: compoundEnabled ? String(selectedTradeAmount) : null,
          useGlobalSsid,
        })
        .returning();

      // Save SSID if provided (personal only)
      if (ssid) {
        await db
          .update(users)
          .set({ pocketOptionSsid: encryptSSID(ssid) })
          .where(eq(users.id, payload.userId));
      }

      // Resolve profit/loss limits: provided > user profile > defaults
      const userProfitTarget = profitTarget || (user.profitTarget ? parseFloat(user.profitTarget) : undefined);
      const userLossLimit = lossLimit || (user.lossLimit ? parseFloat(user.lossLimit) : undefined);

      // Start the BotRunner background loop
      const runner = startBotRunner({
        userId: payload.userId,
        botType: selectedBotType as "signal" | "auto",
        asset: selectedAsset,
        timeframe: selectedTimeframe as Timeframe,
        mode: selectedMode as "DEMO" | "LIVE",
        tradeAmount: selectedTradeAmount,
        confidenceMode: confidenceMode || "standard",
        profitTarget: userProfitTarget,
        lossLimit: userLossLimit,
        martingaleEnabled: martingaleEnabled || false,
        compoundEnabled: compoundEnabled || false,
        compoundTradesTarget: compoundTradesTarget || 0,
        compoundPayoutRate: selectedPayoutRate,
      });

      return NextResponse.json({
        success: true,
        session,
        action: "STARTED",
        useGlobalSsid,
        runnerStatus: runner.getStatus(),
      });
    }

    // ============ STOP ACTION ============
    if (action === "STOP") {
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
