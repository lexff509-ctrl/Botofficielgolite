import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/auth";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";

export async function GET(req: NextRequest) {
  try {
    const session = getUserFromRequest(req);
    if (!session?.userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = session.userId;

    // ✅ Real-time bridge status check
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, userId));

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Check 1: Has extension been active recently?
    const EXTENSION_TIMEOUT = 5 * 60 * 1000; // 5 min timeout for extension
    const lastSyncTime = user.extensionLastSync ? new Date(user.extensionLastSync).getTime() : 0;
    const lastUpdatedTime = user.updatedAt ? new Date(user.updatedAt).getTime() : 0;
    const now = Date.now();

    const extensionRecentlyActive = user.extensionActive &&
      (now - lastSyncTime < EXTENSION_TIMEOUT || now - lastUpdatedTime < EXTENSION_TIMEOUT);

    // Check 2: Is PocketOption actually connected?
    let poConnected = false;
    try {
      const { getPocketOptionClient } = await import("@/services/trading.service");
      const poClient = getPocketOptionClient(userId);
      poConnected = !!poClient && poClient.isConnected && !poClient.isSsidExpired;
    } catch {}

    // Check 3: Is SSID valid?
    const hasSsid = !!user.pocketOptionSsid;
    const ssidExpired = user.ssidStatus === "EXPIRED";

    // Check 4: Cookies diagnostics
    const cookies = user.pocketOptionCookies || "";
    const cookieSize = cookies.length;
    const hasCloudflare = cookies.toLowerCase().includes("cf_clearance");
    
    // Determine overall status
    const bridgeConnected = extensionRecentlyActive && poConnected && hasSsid && !ssidExpired && cookieSize > 0;

    return NextResponse.json({
      success: true,
      status: {
        bridgeConnected,
        extensionActive: user.extensionActive,
        extensionRecentlyActive,
        extensionLastSync: user.extensionLastSync,
        poConnected,
        poSsidExpired: ssidExpired,
        hasSsid,
        cookieSize,
        hasCloudflare,
        lastSyncMinutesAgo: lastSyncTime > 0 ? Math.floor((now - lastSyncTime) / 60000) : null,
        username: user.pocketOptionUsername,
        tradeMode: user.tradeMode,
        demoBalance: user.demoBalance,
        liveBalance: user.liveBalance,
        ssidStatus: user.ssidStatus,
      },
      lastChecked: new Date().toISOString(),
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to get bridge status" },
      { status: 500 }
    );
  }
}
