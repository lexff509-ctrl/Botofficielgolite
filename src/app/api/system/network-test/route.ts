import { NextRequest, NextResponse } from "next/server";
import { testHostReachable, PO_REGIONS } from "@/lib/pocketoption/connection";

/**
 * GET /api/system/network-test
 *
 * Teste la connectivité réseau vers les hôtes PocketOption depuis Render.
 * Retourne les résultats réels en temps réel — pas de théorie, pas de cache.
 *
 * Résultat attendu si OK :
 *   { reachable: ["demo-api-eu.po.market"], unreachable: [...], verdict: "CONNECTED" }
 */
export async function GET(_req: NextRequest) {
  const startTs = Date.now();

  // Test uniquement les 5 hôtes les plus probables (rapide, pas de spam)
  const testHosts = [
    { key: "DEMO",       host: PO_REGIONS.DEMO },
    { key: "DEMO_ALT",   host: PO_REGIONS.DEMO_ALT },
    { key: "EUROPA",     host: PO_REGIONS.EUROPA },
    { key: "SEYCHELLES", host: PO_REGIONS.SEYCHELLES },
    { key: "US_NORTH",   host: PO_REGIONS.US_NORTH },
  ];

  const results = await Promise.all(
    testHosts.map(async ({ key, host }) => {
      const t0 = Date.now();
      try {
        const sid = await testHostReachable(host);
        const latencyMs = Date.now() - t0;
        const reachable = sid !== "";
        return { key, host, reachable, latencyMs, sid: sid || null };
      } catch (err: any) {
        return { key, host, reachable: false, latencyMs: Date.now() - t0, error: err.message };
      }
    })
  );

  const reachable   = results.filter(r => r.reachable);
  const unreachable = results.filter(r => !r.reachable);

  const verdict =
    reachable.length === 0 ? "BLOCKED_ALL" :
    reachable.length < 2   ? "DEGRADED" :
                             "CONNECTED";

  return NextResponse.json({
    verdict,
    testedAt: new Date().toISOString(),
    totalMs: Date.now() - startTs,
    reachableCount: reachable.length,
    totalTested: testHosts.length,
    reachable:   reachable.map(r => ({ host: r.host, latencyMs: r.latencyMs })),
    unreachable: unreachable.map(r => ({ host: r.host, error: (r as any).error || "timeout/refused" })),
    recommendation:
      verdict === "BLOCKED_ALL"
        ? "❌ Render bloque PO API — migrer sur Railway ou Fly.io"
        : verdict === "DEGRADED"
        ? "⚠️ Connexion dégradée — 1 hôte actif, surveillez les reconnexions"
        : "✅ Réseau OK — bots peuvent se connecter",
  }, { status: 200 });
}
