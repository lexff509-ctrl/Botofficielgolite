import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { encryptSSID } from "@/lib/auth";
import { SystemLogger } from "@/lib/system-logger";
import { updateSsidStatus, connectPocketOption } from "@/services/trading.service";
import { getBotRunner, startBotRunner } from "@/services/bot-runner";
import { botSessions } from "@/db/schema";
import { desc } from "drizzle-orm";

export async function POST(req: NextRequest) {
  try {
    // Basic anti-spam: check content length
    if (!req.body || req.headers.get("content-length") === "0") {
      return NextResponse.json({ error: "Empty request" }, { status: 400 });
    }

    const body = await req.json();
    const { apiKey, ssid, uid, deviceName, isDemo, demoBalance, liveBalance, username } = body;

    // 1. Validation stricte
    if (!apiKey || typeof apiKey !== "string") {
      return NextResponse.json({ error: "API Key manquante ou invalide" }, { status: 401 });
    }

    if (!ssid || typeof ssid !== "string") {
      return NextResponse.json({ error: "SSID manquant ou invalide" }, { status: 400 });
    }

    // 2. Chercher l'utilisateur avec cette API Key
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.extensionApiKey, apiKey));

    if (!user) {
      SystemLogger.warn("ExtensionBridge", "Tentative de synchronisation avec API Key invalide", { apiKey: apiKey.substring(0, 5) + "..." });
      return NextResponse.json({ error: "API Key invalide" }, { status: 401 });
    }

    if (!user.isActive) {
      return NextResponse.json({ error: "Compte inactif" }, { status: 403 });
    }

    // 3. Traiter le SSID (Chiffrement sécurisé)
    const encryptedSsid = encryptSSID(ssid);
    const parsedUid = uid ? String(uid) : null;

    // 4. Mettre à jour la base de données
    const updateData: any = {
      pocketOptionSsid: encryptedSsid,
      pocketOptionUid: parsedUid,
      extensionLastSync: new Date(),
      extensionDeviceName: deviceName || "Unknown Browser",
      extensionActive: true,
      ssidStatus: "VALID",
      updatedAt: new Date(),
    };

    if (username) updateData.pocketOptionUsername = username;
    if (demoBalance !== undefined) updateData.demoBalance = String(demoBalance);
    if (liveBalance !== undefined) updateData.liveBalance = String(liveBalance);
    if (isDemo !== undefined) updateData.tradeMode = isDemo ? "DEMO" : "LIVE";

    await db
      .update(users)
      .set(updateData)
      .where(eq(users.id, user.id));

    // Mettre à jour le statut dans la couche trading (pour les dashboards React)
    await updateSsidStatus(user.id, "VALID");

    // 5. Connecter PO avec les nouvelles données (Anti-doublon géré par connectPocketOption mutex)
    const isDemoConnection = isDemo !== undefined ? isDemo : (user.tradeMode === "DEMO");
    connectPocketOption(user.id, ssid, isDemoConnection).catch(err => console.error("PO Connect Error on auto-start:", err));

    // 6. Relancer le bot si nécessaire (Automatique)
    let runner = getBotRunner(user.id);
    if (runner) {
      const expectedMode = isDemoConnection ? "DEMO" : "LIVE";
      if (runner.mode !== expectedMode) {
        SystemLogger.info("ExtensionBridge", `Changement de mode détecté (${runner.mode} -> ${expectedMode}), redémarrage du runner pour l'utilisateur ${user.id}`);
        const currentOpts = runner.getStatus();
        runner.stop();
        runner = startBotRunner({
          userId: user.id,
          botType: currentOpts.botType,
          asset: currentOpts.asset,
          timeframe: currentOpts.timeframe,
          mode: expectedMode,
          tradeAmount: isDemoConnection ? parseFloat(user.demoTradeAmount || "1") : parseFloat(user.liveTradeAmount || "1"),
          confidenceMode: currentOpts.confidenceMode,
          profitTarget: currentOpts.profitTarget,
          lossLimit: currentOpts.lossLimit,
          martingaleEnabled: currentOpts.martingaleEnabled,
          compoundEnabled: currentOpts.compoundEnabled,
          compoundTradesTarget: currentOpts.compoundTradesTarget,
          compoundPayoutRate: currentOpts.compoundPayoutRate,
        });
      } else {
        runner.resume();
        SystemLogger.info("ExtensionBridge", `BotRunner repris pour l'utilisateur ${user.id} suite à synchro SSID`);
      }
    } else {
      // Auto-start since Bridge wants automatic trading if previously configured
      const [lastSession] = await db
        .select()
        .from(botSessions)
        .where(eq(botSessions.userId, user.id))
        .orderBy(desc(botSessions.startedAt))
        .limit(1);

      if (lastSession && lastSession.isRunning) {
        runner = startBotRunner({
          userId: user.id,
          botType: lastSession.botType,
          asset: lastSession.asset,
          timeframe: lastSession.timeframe as any,
          mode: isDemoConnection ? "DEMO" : "LIVE",
          tradeAmount: isDemoConnection ? (parseFloat(user.demoTradeAmount || "1")) : (parseFloat(user.liveTradeAmount || "1")),
          confidenceMode: "standard",
          profitTarget: user.profitTarget ? parseFloat(user.profitTarget) : undefined,
          lossLimit: user.lossLimit ? parseFloat(user.lossLimit) : undefined,
          martingaleEnabled: lastSession.martingaleEnabled,
          compoundEnabled: lastSession.compoundEnabled,
          compoundTradesTarget: lastSession.compoundTradesTarget || 0,
          compoundPayoutRate: 0.92,
        });

        await db.update(botSessions)
          .set({ isRunning: true, stoppedAt: null })
          .where(eq(botSessions.id, lastSession.id));

        SystemLogger.info("ExtensionBridge", `BotRunner auto-démarré pour l'utilisateur ${user.id} via Bridge`);
      } else if (lastSession && !lastSession.isRunning) {
        SystemLogger.info("ExtensionBridge", `Dernière session utilisateur ${user.id} était arrêtée - pas de relance automatique`);
      }
    }

    SystemLogger.info("ExtensionBridge", `SSID synchronisé avec succès pour l'utilisateur ${user.id}`);

    return NextResponse.json({
      success: true,
      message: "Synchronisation réussie",
      lastSync: new Date().toISOString()
    });

  } catch (error: any) {
    // Ne jamais faire crasher le serveur
    console.error("[ExtensionBridge] Erreur critique:", error);
    SystemLogger.error("ExtensionBridge", "Erreur lors de la synchronisation", { error: error.message });
    return NextResponse.json(
      { error: "Erreur interne du serveur" },
      { status: 500 }
    );
  }
}
