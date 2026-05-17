import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/auth";
import { getUserProfile, validateSessionVersion } from "@/services/auth.service";
import { getSessionState } from "@/services/network/PocketOptionConnectionManager";

export async function GET(req: NextRequest) {
  try {
    const payload = getUserFromRequest(req);
    if (!payload) {
      return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
    }

    // Single-device session enforcement: check sessionVersion
    const tokenSessionVersion = payload.sessionVersion ?? 0;
    const isValidSession = await validateSessionVersion(payload.userId, tokenSessionVersion);
    if (!isValidSession) {
      return NextResponse.json(
        { error: "Session expirée. Connectez-vous à nouveau.", sessionExpired: true },
        { status: 401 }
      );
    }

    const user = await getUserProfile(payload.userId);
    if (!user) {
      return NextResponse.json({ error: "Utilisateur introuvable" }, { status: 404 });
    }

    // Compute real-time bridge status — multi-signal detection
    const BRIDGE_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

    // Signal 1: extensionLastSync (primary, requires DB column)
    const lastSyncTs = user.extensionLastSync ? new Date(user.extensionLastSync).getTime() : 0;
    const syncedRecently = lastSyncTs > 0 && (Date.now() - lastSyncTs) < BRIDGE_TIMEOUT_MS;

    // Signal 2: pocketOptionUid + updatedAt (fallback when extension_last_sync column doesn't exist yet)
    const updatedTs = user.updatedAt ? user.updatedAt.getTime() : 0;
    const hasUid = !!user.pocketOptionUid;
    const uidUpdatedRecently = hasUid && updatedTs > 0 && (Date.now() - updatedTs) < BRIDGE_TIMEOUT_MS;

    const bridgeIsReallyActive = syncedRecently || uidUpdatedRecently;

    // Signal 3: Real-time connection state from ConnectionManager
    const connectionState = getSessionState(payload.userId);

    return NextResponse.json({
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        role: user.role,
        subscriptionStatus: user.subscriptionStatus,
        subscriptionExpiresAt: user.subscriptionExpiresAt,
        trialUsed: user.trialUsed,
        isActive: user.isActive,
        isVerified: user.isVerified,
        tradeMode: user.tradeMode,
        pocketOptionUid: user.pocketOptionUid,
        demoBalance: user.demoBalance,
        demoTradeAmount: user.demoTradeAmount,
        liveTradeAmount: user.liveTradeAmount,
        backtestingDaysGranted: user.backtestingDaysGranted,
        ssidStatus: user.ssidStatus,
        profitTarget: user.profitTarget ?? null,
        lossLimit: user.lossLimit ?? null,
        extensionApiKey: user.extensionApiKey,
        extensionLastSync: user.extensionLastSync,
        extensionDeviceName: user.extensionDeviceName,
        extensionActive: bridgeIsReallyActive,
        connectionState: connectionState, // REAL-TIME STATE
        updatedAt: user.updatedAt,       // Fallback for bridge detection when extensionLastSync column missing
        liveBalance: user.liveBalance,
        pocketOptionUsername: user.pocketOptionUsername,
      },
    });
  } catch (error) {
    console.error("Me error:", error);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
