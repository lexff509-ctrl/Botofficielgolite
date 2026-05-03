import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/auth";
import { getUserProfile, validateSessionVersion } from "@/services/auth.service";

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
      },
    });
  } catch (error) {
    console.error("Me error:", error);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
