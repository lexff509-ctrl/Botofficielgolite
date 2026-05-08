// PocketOption Connection Helper
// Handles anti-detection, multi-host failover, cookie pre-fetch, browser-like headers

import https from "https";

const CHROME_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

// Full Chrome-like headers for WebSocket connections
export const WS_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Origin": "https://pocketoption.com",
  "Cache-Control": "no-cache",
  "Accept-Language": "en-US,en;q=0.9,fr;q=0.8",
  "Sec-WebSocket-Version": "13",
  "Sec-WebSocket-Extensions": "permessage-deflate; client_max_window_bits",
};

// Full Chrome-like headers for HTTP requests
export const HTTP_HEADERS = {
  "User-Agent": CHROME_UA,
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9,fr;q=0.8",
  "Accept-Encoding": "gzip, deflate, br",
  "Cache-Control": "no-cache",
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

/** Preferred host order for demo connections */
const DEMO_HOST_ORDER = [
  PO_REGIONS.DEMO,
  PO_REGIONS.DEMO_ALT,
  PO_REGIONS.EUROPA,
  PO_REGIONS.SEYCHELLES,
];

/** Preferred host order for live connections */
const LIVE_HOST_ORDER = [
  PO_REGIONS.EUROPA,
  PO_REGIONS.SEYCHELLES,
  PO_REGIONS.FRANCE,
  PO_REGIONS.FRANCE2,
  PO_REGIONS.US_NORTH,
  PO_REGIONS.US_SOUTH,
  PO_REGIONS.ASIA,
  PO_REGIONS.INDIA,
];

/** Cache of reachable hosts (auto-discovered) */
let reachableHostsCache: { host: string; isDemo: boolean; timestamp: number }[] = [];
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export interface CookieResult {
  cookies: string[];
  cookieHeader: string;
}

/**
 * Test if a host is reachable by doing a quick HTTP polling handshake.
 * Returns the sid if reachable, empty string if not.
 */
export function testHostReachable(host: string): Promise<string> {
  return new Promise((resolve) => {
    const req = https.get({
      hostname: host,
      path: "/socket.io/?EIO=4&transport=polling",
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
        if (res.statusCode === 200 && body.startsWith("0")) {
          try {
            const parsed = JSON.parse(body.substring(1));
            resolve(parsed.sid || "ok");
          } catch {
            resolve("ok");
          }
        } else {
          resolve(""); // Host responded but not valid (e.g., Cloudflare 403)
        }
      });
    });

    req.on("error", () => resolve(""));
    req.setTimeout(2000, () => { // Reduce to 2s
      req.destroy();
      resolve("");
    });
  });
}

/**
 * Auto-discover reachable PocketOption hosts.
 * Tests the preferred hosts in parallel and returns those that respond.
 */
export async function discoverReachableHosts(isDemo: boolean): Promise<string[]> {
  // Check cache
  const now = Date.now();
  const cached = reachableHostsCache.filter(
    (h) => h.isDemo === isDemo && now - h.timestamp < CACHE_TTL
  );
  if (cached.length > 0) {
    return cached.map((h) => h.host);
  }

  const hosts = isDemo ? DEMO_HOST_ORDER : LIVE_HOST_ORDER;
  console.log(`[PO-Discovery] Testing ${hosts.length} ${isDemo ? "demo" : "live"} hosts...`);

  // Try primary host first (fast path) - if it works, return immediately
  const primarySid = await testHostReachable(hosts[0]);
  if (primarySid !== "") {
    console.log(`[PO-Discovery] Primary host ${hosts[0]}: REACHABLE - using immediately`);
    reachableHostsCache = [{ host: hosts[0], isDemo, timestamp: now }];
    // Test remaining hosts in background for caching
    const remaining = hosts.slice(1);
    Promise.all(remaining.map(async (host) => {
      const sid = await testHostReachable(host);
      return { host, reachable: sid !== "" };
    })).then(results => {
      const moreHosts = results.filter(r => r.reachable).map(r => r.host);
      reachableHostsCache = [{ host: hosts[0], isDemo, timestamp: now },
        ...moreHosts.map(h => ({ host: h, isDemo, timestamp: now }))];
      console.log(`[PO-Discovery] Background scan: ${moreHosts.length} more hosts reachable`);
    }).catch(() => {});
    return [hosts[0]];
  }

  // Primary failed, test all remaining in parallel
  console.log(`[PO-Discovery] Primary host ${hosts[0]} unreachable, testing alternatives...`);
  const results = await Promise.all(
    hosts.slice(1).map(async (host) => {
      const sid = await testHostReachable(host);
      const reachable = sid !== "";
      if (reachable) {
        console.log(`[PO-Discovery] ${host}: REACHABLE (sid=${sid.substring(0, 8)}...)`);
      } else {
        console.log(`[PO-Discovery] ${host}: unreachable`);
      }
      return { host, reachable };
    })
  );

  const reachable = results.filter((r) => r.reachable).map((r) => r.host);

  // Update cache
  reachableHostsCache = reachable.map((host) => ({ host, isDemo, timestamp: now }));

  console.log(`[PO-Discovery] ${reachable.length}/${hosts.length - 1} alternative hosts reachable: ${reachable.join(", ")}`);
  return reachable;
}

/**
 * Get the best host for a demo or live connection.
 * Tries the primary host first, then auto-discovers alternatives.
 */
export async function getBestHost(isDemo: boolean): Promise<string> {
  const reachable = await discoverReachableHosts(isDemo);
  return reachable[0] || (isDemo ? PO_REGIONS.DEMO : PO_REGIONS.EUROPA);
}

/**
 * Pre-fetch cookies from PocketOption site before WebSocket connection.
 * Mimics a real browser visit: navigate to the site first,
 * get cookies (including cf_clearance for Cloudflare), then connect WS.
 */
export async function preFetchCookies(host: string): Promise<CookieResult> {
  return new Promise((resolve) => {
    const options: https.RequestOptions = {
      hostname: host,
      path: "/",
      method: "GET",
      headers: {
        ...HTTP_HEADERS,
        Host: host,
      },
    };

    const req = https.get(options, (res) => {
      const setCookies = res.headers["set-cookie"] || [];
      const cookies = setCookies.map((c: string) => c.split(";")[0]);
      const cookieHeader = cookies.join("; ");

      console.log(`[PO-Cookie] Got ${cookies.length} cookies from ${host}`);
      
      res.on("data", () => {}); // Consume data
      res.on("end", () => {
        resolve({ cookies, cookieHeader });
      });
    });

    req.on("error", (err: Error) => {
      console.warn(`[PO-Cookie] Pre-fetch failed for ${host}: ${err.message}`);
      resolve({ cookies: [], cookieHeader: "" });
    });

    req.setTimeout(5000, () => { // Reduce to 5s
      console.warn(`[PO-Cookie] Pre-fetch timeout for ${host}`);
      req.destroy();
      resolve({ cookies: [], cookieHeader: "" });
    });
  });
}

/**
 * Calculate reconnection delay with exponential backoff + jitter.
 * Prevents thundering herd and looks more human-like.
 * Formula: base * 2^attempt + random jitter (75%-125%)
 */
export function getReconnectDelay(attempt: number, maxDelay = 60000): number {
  const base = 3000;
  const exponentialDelay = base * Math.pow(2, attempt);
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
