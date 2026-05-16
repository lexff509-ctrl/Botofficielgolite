import { NextResponse } from "next/server";
import { getAllRunnersStatus } from "@/services/bot-runner";
import { getAllSessionStatus } from "@/services/network/PocketOptionConnectionManager";
import { getHostQualityReport } from "@/lib/pocketoption/connection";

/**
 * GET /api/system/health
 *
 * Retourne le statut complet du système en temps réel.
 * Utilisé pour valider que chaque étape du plan de remédiation fonctionne.
 */
export async function GET() {
  try {
    // 1. État des connexions PocketOption
    const sessions = getAllSessionStatus();

    // 2. État des bots actifs
    const runners = getAllRunnersStatus();

    // 3. Qualité des hôtes (historique)
    const hostQuality = getHostQualityReport();

    // 4. État mémoire/processus
    const memMb = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);

    // 5. Verdict global
    const activeSessions = Object.values(sessions).filter((s: any) => s.state === "READY").length;
    const runningBots    = runners.filter(r => r.running && !r.paused).length;
    const blockedBots    = runners.filter(r => r.paused).length;

    const systemStatus =
      activeSessions === 0 && runners.length > 0 ? "DISCONNECTED" :
      blockedBots > 0 && runningBots === 0        ? "PAUSED"       :
      runningBots > 0                             ? "TRADING"      :
                                                    "IDLE";

    return NextResponse.json({
      status: systemStatus,
      timestamp: new Date().toISOString(),
      uptime: Math.round(process.uptime()),
      memoryMb: memMb,

      // Connexions WebSocket
      connections: {
        total:     Object.keys(sessions).length,
        ready:     activeSessions,
        blocked:   Object.values(sessions).filter((s: any) => s.state === "BLOCKED").length,
        cooldown:  Object.values(sessions).filter((s: any) => s.state === "COOLDOWN").length,
        reconnecting: Object.values(sessions).filter((s: any) => s.state === "RECONNECTING").length,
        details:   sessions,
      },

      // Bots
      bots: {
        total:   runners.length,
        running: runningBots,
        paused:  blockedBots,
        stopped: runners.filter(r => !r.running).length,
        details: runners.map(r => ({
          userId:          r.userId,
          asset:           r.asset,
          timeframe:       r.timeframe,
          mode:            r.mode,
          running:         r.running,
          paused:          r.paused,
          pauseReason:     r.pauseReason,
          signalsGenerated: r.signalsGenerated,
          tradesExecuted:  r.tradesExecuted,
          dailyProfit:     r.dailyProfit,
          consecutiveErrors: r.consecutiveErrors,
        })),
      },

      // Réseau hôtes
      network: {
        hostsMonitored: Object.keys(hostQuality).length,
        reachableHosts: Object.values(hostQuality).filter((h: any) => h.lastReachable).length,
        topHosts: Object.entries(hostQuality)
          .filter(([, h]: any) => h.lastReachable)
          .sort(([, a]: any, [, b]: any) => a.avgLatencyMs - b.avgLatencyMs)
          .slice(0, 3)
          .map(([host, h]: any) => ({ host, latencyMs: h.avgLatencyMs, successRate: h.successRate })),
      },
    });
  } catch (err: any) {
    return NextResponse.json(
      { status: "ERROR", error: err.message },
      { status: 500 }
    );
  }
}
