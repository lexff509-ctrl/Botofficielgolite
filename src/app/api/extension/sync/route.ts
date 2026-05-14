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

    // 4a. Champs CORE — essayer avec les champs extension, fallback sur minimum absolu
    try {
      await db.update(users).set({
        pocketOptionSsid: encryptedSsid,
        pocketOptionUid: parsedUid,
        extensionLastSync: new Date(),
        extensionDeviceName: deviceName || "Unknown Browser",
        updatedAt: new Date(),
        ssidStatus: "VALID",   // ← toujours inclus dans le bloc principal
      }).where(eq(users.id, user.id));
    } catch {
      // Fallback: colonnes extension absentes en prod
      console.warn("[ExtensionBridge] Extension columns missing, using minimal update");
      try {
        await db.update(users).set({
          pocketOptionSsid: encryptedSsid,
          pocketOptionUid: parsedUid,
          updatedAt: new Date(),
          ssidStatus: "VALID",  // ← inclus aussi dans le fallback
        }).where(eq(users.id, user.id));
      } catch {
        // dernier recours: uniquement SSID
        await db.update(users).set({
          pocketOptionSsid: encryptedSsid,
          updatedAt: new Date(),
        }).where(eq(users.id, user.id));
      }
    }

    // 4b. Champs ENUM (tradeMode) — séparés car ils peuvent manquer en prod ancienne
    try {
      if (isDemo !== undefined) {
        await db.update(users).set({ tradeMode: isDemo ? "DEMO" : "LIVE" }).where(eq(users.id, user.id));
      }
    } catch (enumErr: any) {
      console.warn("[ExtensionBridge] tradeMode enum field skipped:", enumErr.message);
    }

    // 4c. Nouveaux champs — ajoutés via auto-migration. Try-catch si colonne absente en prod.
    try {
      const extUpdate: any = { extensionActive: true };
      if (username) extUpdate.pocketOptionUsername = username;
      if (demoBalance !== undefined) extUpdate.demoBalance = String(demoBalance);
      if (liveBalance !== undefined) extUpdate.liveBalance = String(liveBalance);
      await db.update(users).set(extUpdate).where(eq(users.id, user.id));
    } catch (extErr: any) {
      console.warn("[ExtensionBridge] Extended fields skipped (migration pending):", extErr.message);
    }

    // Mettre à jour ssidStatus via fonction dédiée (fallback supplémentaire)
    updateSsidStatus(user.id, "VALID").catch(() => {});

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
    console.error("[ExtensionBridge] Erreur critique:", error?.message, error?.stack);
    SystemLogger.error("ExtensionBridge", "Erreur lors de la synchronisation", { error: error.message, stack: error.stack });
    return NextResponse.json(
      { error: "Erreur interne du serveur", hint: error?.message?.substring(0, 300) },
      { status: 500 }
    );
  }
}
