import { NextResponse } from "next/server";
import { getRedisStatus } from "@/lib/redis";
import { getAllSessionStatus } from "@/services/network/PocketOptionConnectionManager";
import { getHostQualityReport } from "@/lib/pocketoption/connection";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";

/**
 * GET /api/system/diagnostics
 * 
 * "Operating System" diagnostic route to identify EXACTLY why connectivity fails.
 */
export async function GET() {
  try {
    const redisStatus = getRedisStatus();
    const sessions = getAllSessionStatus();
    const hostQuality = getHostQualityReport();

    // Get all active users to check their cookie status in DB
    const allUsers = await db.select().from(users).where(eq(users.isActive, true));

    const userDiagnostics = allUsers.map(u => {
      const session = (sessions as any)[u.id];
      const cookies = u.pocketOptionCookies || "";
      const cookieSize = cookies.length;
      
      const hasCloudflare = cookies.toLowerCase().includes("cf_clearance");
      const hasSsid = cookies.toLowerCase().includes("phpsessid") || (u.pocketOptionSsid && u.pocketOptionSsid.length > 20);

      let status = "OK";
      let problems = [];

      if (cookieSize === 0) {
        status = "CRITICAL";
        problems.push("NO_COOKIES: Extension has not sent any cookies yet.");
      } else if (!hasCloudflare) {
        status = "WARNING";
        problems.push("MISSING_CLOUDFLARE: Connection might be blocked by Cloudflare (403/400). Refresh PO page.");
      }

      if (u.ssidStatus === "EXPIRED" || u.ssidStatus === "NOT_SET") {
        status = "CRITICAL";
        problems.push(`SSID_${u.ssidStatus}: Please refresh PocketOption page in your browser.`);
      } else if (u.ssidStatus === "UNKNOWN") {
        status = "WARNING";
        problems.push("SSID_UNKNOWN: Waiting for connection verification.");
      }

      if (session && session.state === "RECONNECTING") {
        problems.push(`NETWORK_ISSUE: Host ${session.host} is unstable.`);
      }

      return {
        userId: u.id,
        username: u.username,
        status,
        problems,
        details: {
          ssidStatus: u.ssidStatus,
          cookieSize,
          hasCloudflare,
          hasSsid,
          lastSync: u.extensionLastSync,
          deviceName: u.extensionDeviceName,
          connectionState: session ? session.state : "IDLE",
          activeHost: session ? session.host : "none"
        }
      };
    });

    return NextResponse.json({
      timestamp: new Date().toISOString(),
      system: {
        redis: redisStatus,
        nodeVersion: process.version,
        platform: process.platform,
        memoryUsage: process.memoryUsage()
      },
      network: {
        reachableHosts: Object.values(hostQuality).filter((h: any) => h.lastReachable).length,
        totalHostsTested: Object.keys(hostQuality).length,
        bestHosts: Object.entries(hostQuality)
          .filter(([, h]: any) => h.lastReachable)
          .sort(([, a]: any, [, b]: any) => a.avgLatencyMs - b.avgLatencyMs)
          .slice(0, 3)
          .map(([host, h]: any) => ({ host, latency: h.avgLatencyMs }))
      },
      users: userDiagnostics,
      verdict: {
        redisStable: redisStatus.available,
        allUsersConnected: userDiagnostics.every(u => u.status === "OK"),
        criticalProblems: userDiagnostics.filter(u => u.status === "CRITICAL").length
      }
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
