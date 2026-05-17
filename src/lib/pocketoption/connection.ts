// PocketOption Connection Helper
// Handles anti-detection, multi-host failover, cookie pre-fetch, browser-like headers

import https from "https";

const CHROME_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

// Full Chrome-like headers for WebSocket connections
export const WS_HEADERS = {
  "User-Agent": CHROME_UA,
  "Origin": "https://pocketoption.com",
  "Referer": "https://pocketoption.com/",
  "Cache-Control": "no-cache",
  "Accept-Language": "en-US,en;q=0.9,fr;q=0.8",
  "Sec-WebSocket-Version": "13",
};

// Full Chrome-like headers for HTTP requests
export const HTTP_HEADERS = {
  "User-Agent": CHROME_UA,
  "Origin": "https://pocketoption.com",
  "Referer": "https://pocketoption.com/",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
  "Accept-Language": "en-US,en;q=0.9,fr;q=0.8",
  "Cache-Control": "no-cache",
  "Pragma": "no-cache",
  "Sec-Ch-Ua": '"Chromium";v="131", "Not_A Brand";v="24", "Google Chrome";v="131"',
  "Sec-Ch-Ua-Mobile": "?0",
  "Sec-Ch-Ua-Platform": '"Windows"',
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none",
  "Sec-Fetch-User": "?1",
  "Upgrade-Insecure-Requests": "1",
};

// ============ Multi-Host Configuration ============

/** All known PocketOption WebSocket region hosts */
export const PO_REGIONS: Record<string, string> = {
  DEMO:          "demo-api-eu.po.market",
  DEMO_ALT:      "try-demo-eu.po.market",
  EUROPA:        "api-eu.po.market",
  SEYCHELLES:    "api-sc.po.market",
  HONGKONG:      "api-hk.po.market",
  FRANCE:        "api-fr.po.market",
  FRANCE2:       "api-fr2.po.market",
  SERVER1:       "api-spb.po.market",
  US_NORTH:      "api-us-north.po.market",
  US_SOUTH:      "api-us-south.po.market",
  US2:           "api-us2.po.market",
  US3:           "api-us3.po.market",
  US4:           "api-us4.po.market",
  RUSSIA:        "api-msk.po.market",
  SERVER2:       "api-l.po.market",
  INDIA:         "api-in.po.market",
  FINLAND:       "api-fin.po.market",
  SERVER3:       "api-c.po.market",
  ASIA:          "api-asia.po.market",
};

/** All demo hosts ordered by priority (broadest pool = higher chance of Render connectivity) */
const DEMO_HOST_ORDER = [
  PO_REGIONS.DEMO,
  PO_REGIONS.DEMO_ALT,
  PO_REGIONS.EUROPA,
  PO_REGIONS.SEYCHELLES,
  PO_REGIONS.US_NORTH,
  PO_REGIONS.US_SOUTH,
  PO_REGIONS.US2,
  PO_REGIONS.US3,
  PO_REGIONS.US4,
  PO_REGIONS.ASIA,
  PO_REGIONS.FRANCE,
  PO_REGIONS.FRANCE2,
  PO_REGIONS.INDIA,
  PO_REGIONS.FINLAND,
  PO_REGIONS.HONGKONG,
];

/** All live hosts ordered by priority */
const LIVE_HOST_ORDER = [
  PO_REGIONS.EUROPA,
  PO_REGIONS.SEYCHELLES,
  PO_REGIONS.US_NORTH,
  PO_REGIONS.US_SOUTH,
  PO_REGIONS.US2,
  PO_REGIONS.US3,
  PO_REGIONS.US4,
  PO_REGIONS.FRANCE,
  PO_REGIONS.FRANCE2,
  PO_REGIONS.ASIA,
  PO_REGIONS.INDIA,
  PO_REGIONS.FINLAND,
  PO_REGIONS.HONGKONG,
  PO_REGIONS.RUSSIA,
];

// ============ Host Cache with Quality Scoring ============

interface HostCacheEntry {
  host: string;
  isDemo: boolean;
  timestamp: number;
  latencyMs: number;    // Round-trip latency
  successRate: number;  // 0-1, success rate over last N tests
}

let reachableHostsCache: HostCacheEntry[] = [];
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes (critical for stability)

// ============ Monitoring Stats (Institutional Grade) ============

interface HostStat {
  host: string;
  successCount: number;
  failCount: number;
  totalLatencyMs: number;
  lastTestedAt: number;
  lastReachable: boolean;
}

const hostStats: Map<string, HostStat> = new Map();

function recordHostResult(host: string, success: boolean, latencyMs: number) {
  const existing = hostStats.get(host) || {
    host, successCount: 0, failCount: 0, totalLatencyMs: 0, lastTestedAt: 0, lastReachable: false
  };
  if (success) {
    existing.successCount++;
    existing.totalLatencyMs += latencyMs;
  } else {
    existing.failCount++;
  }
  existing.lastTestedAt = Date.now();
  existing.lastReachable = success;
  hostStats.set(host, existing);
}

export function getHostQualityReport(): Record<string, { successRate: number; avgLatencyMs: number; lastReachable: boolean }> {
  const report: Record<string, any> = {};
  for (const [host, stat] of hostStats.entries()) {
    const total = stat.successCount + stat.failCount;
    report[host] = {
      successRate: total > 0 ? stat.successCount / total : 0,
      avgLatencyMs: stat.successCount > 0 ? Math.round(stat.totalLatencyMs / stat.successCount) : 0,
      lastReachable: stat.lastReachable,
    };
  }
  return report;
}

export interface CookieResult {
  cookies: string[];
  cookieHeader: string;
}

/**
 * Test if a host is reachable by doing a quick HTTP polling handshake.
 * Returns { reachable, latencyMs }.
 */
export function testHostReachable(host: string): Promise<string> {
  const startTs = Date.now();
  return new Promise((resolve) => {
    const req = https.get({
      hostname: host,
      path: `/socket.io/?EIO=4&transport=polling&t=${Date.now()}`,
      method: "GET",
      headers: {
        "User-Agent": CHROME_UA,
        Accept: "*/*",
        Host: host,
        Origin: "https://pocketoption.com",
        Referer: "https://pocketoption.com/",
      },
    }, (res) => {
      let body = "";
      res.on("data", (chunk: Buffer) => { body += chunk.toString(); });
      res.on("end", () => {
        const latency = Date.now() - startTs;
        if (res.statusCode === 200 && body.startsWith("0")) {
          try {
            const parsed = JSON.parse(body.substring(1));
            recordHostResult(host, true, latency);
            resolve(parsed.sid || "ok");
          } catch {
            recordHostResult(host, true, latency);
            resolve("ok");
          }
        } else {
          recordHostResult(host, false, 0);
          resolve("");
        }
      });
    });

    req.on("error", () => {
      recordHostResult(host, false, 0);
      resolve("");
    });
    req.setTimeout(5000, () => {
      req.destroy();
      recordHostResult(host, false, 0);
      resolve("");
    });
  });
}

/**
 * Auto-discover reachable PocketOption hosts.
 * Tests the preferred hosts in parallel and returns those that respond.
 * Uses a broader host pool for Render production compatibility.
 */
export async function discoverReachableHosts(isDemo: boolean): Promise<string[]> {
  const now = Date.now();

  const cached = reachableHostsCache.filter(
    (h) => h.isDemo === isDemo && now - h.timestamp < CACHE_TTL
  );
  if (cached.length > 0) {
    cached.sort((a, b) => b.successRate - a.successRate);
    console.log(`[PO-Discovery] Using ${cached.length} cached hosts (TTL: ${Math.round((CACHE_TTL - (now - cached[0].timestamp)) / 1000)}s remaining)`);
    return cached.map((h) => h.host);
  }

  const hosts = isDemo ? DEMO_HOST_ORDER : LIVE_HOST_ORDER;
  // Sequential batches of 3 — prevents Render rate-limit / socket exhaustion from 15 parallel pings
  const BATCH_SIZE = 3;
  const allReachable: { host: string; latencyMs: number }[] = [];

  console.log(`[PO-Discovery] Testing ${hosts.length} ${isDemo ? "demo" : "live"} hosts (batches of ${BATCH_SIZE})...`);

  for (let i = 0; i < hosts.length; i += BATCH_SIZE) {
    const batch = hosts.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.all(
      batch.map(async (host) => {
        const startTs = Date.now();
        const sid = await testHostReachable(host);
        const latencyMs = Date.now() - startTs;
        const reachable = sid !== "";
        if (reachable) console.log(`[PO-Discovery] ✓ ${host}: REACHABLE (${latencyMs}ms)`);
        return { host, reachable, latencyMs };
      })
    );
    const batchReachable = batchResults.filter(r => r.reachable);
    allReachable.push(...batchReachable);

    // Early exit: found 2+ good hosts, no need to probe all 15
    if (allReachable.length >= 2) {
      console.log(`[PO-Discovery] Early exit — ${allReachable.length} hosts found after batch ${Math.ceil((i + BATCH_SIZE) / BATCH_SIZE)}`);
      break;
    }
  }

  const reachable = allReachable;
  console.log(`[PO-Discovery] ${reachable.length}/${hosts.length} alternative hosts reachable`);

  // If no hosts found, add fallback with lower score but still usable
  if (reachable.length === 0) {
    console.warn(`[PO-Discovery] ⚠ No hosts reachable! Adding fallback hosts...`);
    const fallbackHosts = isDemo
      ? [PO_REGIONS.DEMO, PO_REGIONS.DEMO_ALT, PO_REGIONS.EUROPA]
      : [PO_REGIONS.EUROPA, PO_REGIONS.SEYCHELLES, PO_REGIONS.US_NORTH];

    reachableHostsCache = fallbackHosts.map(host => ({
      host, isDemo, timestamp: now, latencyMs: 5000, successRate: 0.3
    }));
    console.log(`[PO-Discovery] Using fallback hosts: ${fallbackHosts.join(", ")}`);
    return fallbackHosts;
  }

  reachableHostsCache = reachable.map(r => ({
    host: r.host, isDemo, timestamp: now, latencyMs: r.latencyMs, successRate: 1.0
  }));

  reachableHostsCache.sort((a, b) => a.latencyMs - b.latencyMs);

  return reachableHostsCache.map(h => h.host);
}

/**
 * Invalidate host cache to force fresh discovery on next connect.
 */
export function invalidateHostCache(): void {
  reachableHostsCache = [];
  console.log("[PO-Discovery] Host cache invalidated — will rediscover on next connect");
}

/**
 * Get the best host for a demo or live connection.
 */
export async function getBestHost(isDemo: boolean): Promise<string> {
  const reachable = await discoverReachableHosts(isDemo);
  return reachable[0] || (isDemo ? PO_REGIONS.DEMO : PO_REGIONS.EUROPA);
}

/**
 * Pre-fetch cookies from PocketOption API host (Cloudflare + session cookies).
 * MUST be called for the specific target host to get valid Cloudflare cookies.
 */
export async function preFetchCookies(host: string): Promise<CookieResult> {
  // Try preferred host first, then main domain as fallback
  const hostsToTry = [host, "pocketoption.com"];
  let allCookies: string[] = [];

  for (const currentHost of hostsToTry) {
    try {
      const cookies = await _fetchFromHost(currentHost);
      if (cookies.length > 0) {
        allCookies = [...allCookies, ...cookies];
        console.log(`[PO-Cookie] Got ${cookies.length} cookies from ${currentHost}`);
      }
    } catch (err) {
      console.warn(`[PO-Cookie] Failed to fetch from ${currentHost}`);
    }
  }

  // Remove duplicates
  const uniqueCookies = [...new Set(allCookies)];
  return {
    cookies: uniqueCookies,
    cookieHeader: uniqueCookies.join("; ")
  };
}

async function _fetchFromHost(host: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const options: https.RequestOptions = {
      hostname: host,
      path: host.includes("pocketoption.com") ? "/" : `/socket.io/?EIO=4&transport=polling&t=${Date.now()}`,
      method: "GET",
      headers: {
        ...HTTP_HEADERS,
        Host: host,
      },
      timeout: 8000,
    };

    const req = https.get(options, (res) => {
      const setCookies = res.headers["set-cookie"] || [];
      const cookies = setCookies.map((c: string) => c.split(";")[0]);
      res.on("data", () => {});
      res.on("end", () => resolve(cookies));
    });

    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Timeout"));
    });
  });
}

/**
 * Calculate reconnection delay with true exponential backoff + jitter.
 * Prevents thundering herd and looks more human-like.
 * Caps at maxDelay (default: 5 minutes for circuit breaker).
 */
export function getReconnectDelay(attempt: number, maxDelay = 300000): number {
  const base = 3000;
  const exponentialDelay = base * Math.pow(2, Math.min(attempt, 8)); // cap exponent at 8 = ~12min base
  const jitter = exponentialDelay * (0.75 + Math.random() * 0.5);
  return Math.min(jitter, maxDelay);
}

/**
 * Add a random jitter delay before executing a trade.
 * Makes the bot look more human-like and avoids rate detection.
 */
export function getTradeJitter(): number {
  return Math.floor(Math.random() * 500) + 200;
}
