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
import { tradeMutexManager } from "@/services/trade-mutex.manager";
import { redis, setCache, getCache, isRedisReady } from "@/lib/redis";

// ============ Intelligent Session Cache (Anti-spam) ============
// Prevents the extension from spamming the server with identical syncs
const SYNC_COOLDOWN_MS = 45 * 1000; // Min 45s between identical syncs

function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < Math.min(str.length, 50); i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return hash.toString(36);
}

export async function POST(req: NextRequest) {
  try {
    // Basic anti-spam: check content length
    if (!req.body || req.headers.get("content-length") === "0") {
      return NextResponse.json({ error: "Empty request" }, { status: 400 });
    }

    const body = await req.json();
    const { apiKey, ssid, cookies, uid, deviceName, isDemo, demoBalance, liveBalance, username } = body;

    // ✅ DEBUG LOG for cookies investigation
    const cookieSize = cookies ? String(cookies).length : 0;
    console.log(`[ExtensionBridge] Sync request: SSID=${ssid?.substring(0, 10)}..., Cookies=${cookieSize} bytes, UID=${uid}, Demo=${isDemo}`);

    if (cookieSize === 0) {
      SystemLogger.warn("ExtensionBridge", "Cookies manquants dans la synchronisation. La connexion Cloudflare risque d'échouer.");
    }

    // 1. Validation stricte
    if (!apiKey || typeof apiKey !== "string") {
      return NextResponse.json({ error: "API Key manquante ou invalide" }, { status: 401 });
    }

    if (!ssid || typeof ssid !== "string") {
      return NextResponse.json({ error: "SSID manquant ou invalide" }, { status: 400 });
    }

    // 2. Rate-limit: skip if same SSID synced recently
    const ssidHash = simpleHash(ssid + (cookies || ""));
    const cacheKey = `sync_cache:${apiKey}`;
    
    if (isRedisReady()) {
      const cachedHash = await getCache(cacheKey);
      if (cachedHash === ssidHash) {
        return NextResponse.json({
          success: true,
          message: "Session déjà synchronisée (Redis cache)",
          cached: true
        });
      }
      await setCache(cacheKey, ssidHash, 45); // 45s TTL
    } else {
      // Memory fallback for sync cache (less persistent but works)
      // (Optional: keep a small Map if Redis is down)
    }


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

    // ✅ BUG FIX #7: Validate SSID format before using (minimum length + format check)
    if (!ssid || ssid.length < 10) {
      console.warn(`[ExtensionBridge] Invalid SSID format from extension for user ${user.id}`);
      return NextResponse.json({
        error: "SSID invalide ou trop court",
        success: false
      }, { status: 400 });
    }

    // 4a. Champs CORE — essayer avec les champs extension, fallback sur minimum absolu
    const dbUpdate: any = {
      pocketOptionSsid: encryptedSsid,
      pocketOptionCookies: cookies || null,
      pocketOptionUid: parsedUid,
      extensionLastSync: new Date(),
      extensionDeviceName: deviceName || "Unknown Browser",
      updatedAt: new Date(),
    };

    // Only set to UNKNOWN if not already VALID to prevent dashboard flickering
    if (user.ssidStatus !== "VALID") {
      dbUpdate.ssidStatus = "UNKNOWN";
    }

    try {
      await db.update(users).set(dbUpdate).where(eq(users.id, user.id));
    } catch {
      // Fallback: colonnes extension absentes en prod
      console.warn("[ExtensionBridge] Extension columns missing, using minimal update");
      const minimalUpdate: any = {
        pocketOptionSsid: encryptedSsid,
        pocketOptionCookies: cookies || null,
        updatedAt: new Date(),
      };
      if (user.ssidStatus !== "VALID") minimalUpdate.ssidStatus = "UNKNOWN";
      
      try {
        await db.update(users).set(minimalUpdate).where(eq(users.id, user.id));
      } catch {
        // dernier recours: uniquement SSID
        await db.update(users).set({
          pocketOptionSsid: encryptedSsid,
          pocketOptionCookies: cookies || null,
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

      // ✅ BUG FIX #3: Validate balance against PO API before trusting extension data
      let validatedDemoBalance: string | undefined;
      let validatedLiveBalance: string | undefined;

      try {
        const poClient = (await import("@/services/trading.service")).getPocketOptionClient(user.id);
        if (poClient && poClient.isConnected && poClient.getAccountData) {
          const accountData = poClient.getAccountData();
          if (accountData) {
            // Only use extension balance if it roughly matches PO API (within 10% tolerance)
            if (demoBalance !== undefined && accountData.isDemo) {
              const apiBalance = parseFloat(String(accountData.balance || "0"));
              const extBalance = parseFloat(String(demoBalance));
              const diff = Math.abs(apiBalance - extBalance) / Math.max(apiBalance, extBalance);
              if (diff < 0.1) {
                validatedDemoBalance = String(apiBalance);
              } else {
                validatedDemoBalance = String(apiBalance);
              }
            }
            if (liveBalance !== undefined && !accountData.isDemo) {
              const apiBalance = parseFloat(String(accountData.balance || "0"));
              const extBalance = parseFloat(String(liveBalance));
              const diff = Math.abs(apiBalance - extBalance) / Math.max(apiBalance, extBalance);
              if (diff < 0.1) {
                validatedLiveBalance = String(apiBalance);
              } else {
                validatedLiveBalance = String(apiBalance);
              }
            }
          }
        } else {
          // Client not connected yet, trust the extension data directly
          if (demoBalance !== undefined) validatedDemoBalance = String(Math.max(0, parseFloat(String(demoBalance))));
          if (liveBalance !== undefined) validatedLiveBalance = String(Math.max(0, parseFloat(String(liveBalance))));
        }
      } catch (validErr) {
        console.warn(`[Balance Validation] Could not validate against PO API:`, validErr);
        // Fallback: use extension values with validation
        if (demoBalance !== undefined) validatedDemoBalance = String(Math.max(0, parseFloat(String(demoBalance))));
        if (liveBalance !== undefined) validatedLiveBalance = String(Math.max(0, parseFloat(String(liveBalance))));
      }

      if (validatedDemoBalance !== undefined) extUpdate.demoBalance = validatedDemoBalance;
      if (validatedLiveBalance !== undefined) extUpdate.liveBalance = validatedLiveBalance;
      await db.update(users).set(extUpdate).where(eq(users.id, user.id));
    } catch (extErr: any) {
      console.warn("[ExtensionBridge] Extended fields skipped (migration pending):", extErr.message);
    }

    // ✅ BUG FIX: REMOVED premature updateSsidStatus(user.id, "VALID")
    // Status MUST remain "UNKNOWN" until ConnectionManager confirms success.

    // 5. Connection Manager: refresh ou connect (remplace connectPocketOption direct)
    const isDemoConnection = isDemo !== undefined ? isDemo : (user.tradeMode === "DEMO");
    try {
      const { refreshSession } = await import("@/services/network/PocketOptionConnectionManager");
      refreshSession(user.id, ssid, isDemoConnection, cookies, uid).catch(err =>
        console.error("[ExtensionBridge] ConnectionManager refresh error:", err.message)
      );
    } catch {
      // Fallback si module pas encore chargé
      connectPocketOption(user.id, ssid, isDemoConnection).catch(err =>
        console.error("[ExtensionBridge] PO Connect Error on auto-start:", err)
      );
    }


    // 6. Relancer le bot si nécessaire (Automatique)
    // ✅ BUG FIX #4: Add mutex lock to prevent bot duplication on concurrent syncs
    const botStartLockKey = `bot_start:${user.id}`;
    if (!await tradeMutexManager.acquireLock(botStartLockKey, 10000)) {
      console.warn(`[ExtensionBridge] Bot start already in progress for user ${user.id}, skipping duplicate start`);
      return NextResponse.json({
        success: true,
        message: "Synchronisation réussie (bot start en cours)",
        lastSync: new Date().toISOString()
      });
    }

    try {
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
    } finally {
      await tradeMutexManager.releaseLock(botStartLockKey);
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
