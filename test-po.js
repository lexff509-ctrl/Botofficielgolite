#!/usr/bin/env node

/**
 * PocketOption WebSocket Connection Diagnostic
 * Direct test without TypeScript compilation overhead
 */

const https = require("https");
const WebSocket = require("ws");

const CHROME_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const WS_HEADERS = {
  "User-Agent": CHROME_UA,
  "Origin": "https://pocketoption.com",
  "Cache-Control": "no-cache",
  "Accept-Language": "en-US,en;q=0.9,fr;q=0.8",
  "Sec-WebSocket-Version": "13",
  "Sec-WebSocket-Extensions": "permessage-deflate; client_max_window_bits",
};

const HTTP_HEADERS = {
  "User-Agent": CHROME_UA,
  "Origin": "https://pocketoption.com",
  "Referer": "https://pocketoption.com/",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9,fr;q=0.8",
  "Cache-Control": "no-cache",
};

const DEMO_HOSTS = [
  "demo-api-eu.po.market",
  "try-demo-eu.po.market",
  "api-eu.po.market",
];

async function testHostReachable(host) {
  return new Promise((resolve) => {
    const req = https.get({
      hostname: host,
      path: `/socket.io/?EIO=4&transport=polling&t=${Date.now()}`,
      method: "GET",
      headers: { "User-Agent": CHROME_UA, Host: host, Origin: "https://pocketoption.com" },
    }, (res) => {
      let body = "";
      res.on("data", (chunk) => { body += chunk.toString(); });
      res.on("end", () => {
        if (res.statusCode === 200 && body.startsWith("0")) {
          try {
            const parsed = JSON.parse(body.substring(1));
            const cookies = (res.headers["set-cookie"] || []).map((c) => c.split(";")[0]);
            console.log(`  ✅ ${host} REACHABLE (${cookies.length} cookies)`);
            resolve({ host, sid: parsed.sid, cookies });
          } catch {
            resolve({ host, sid: null, cookies: [] });
          }
        } else {
          resolve({ host, sid: null, cookies: [] });
        }
      });
    });
    req.on("error", () => resolve({ host, sid: null, cookies: [] }));
    req.setTimeout(5000, () => { req.destroy(); resolve({ host, sid: null, cookies: [] }); });
  });
}

async function testDirectWebSocket(host, ssid, cookies) {
  return new Promise((resolve) => {
    const wsUrl = `wss://${host}/socket.io/?EIO=4&transport=websocket`;
    const headers = { ...WS_HEADERS, Cookie: cookies.join("; ") };

    let authenticated = false;
    const timeout = setTimeout(() => {
      console.log(`  ❌ Direct WebSocket timeout after 15s`);
      ws.close();
      resolve(false);
    }, 15000);

    const ws = new WebSocket(wsUrl, { headers, perMessageDeflate: false });

    ws.on("open", () => {
      console.log(`  📡 WebSocket OPEN`);
    });

    ws.on("message", (raw) => {
      const text = typeof raw === "string" ? raw : raw.toString("utf8");

      if (text.startsWith("0")) {
        console.log(`  🔌 Engine.IO OPEN (0)`);
        ws.send("40"); // Socket.IO CONNECT
      } else if (text.startsWith("40")) {
        console.log(`  🔐 Socket.IO CONNECT, sending auth...`);
        const authMessage = '42' + JSON.stringify([
          "auth",
          {
            session: ssid,
            isDemo: 1,
            uid: 0,
            platform: 2,
            isFastHistory: true,
            isOptimized: true
          }
        ]);
        ws.send(authMessage);
      } else if (text.startsWith("42") && text.includes("successauth")) {
        console.log(`  ✅ AUTHENTICATED!`);
        authenticated = true;
        clearTimeout(timeout);
        ws.close();
        resolve(true);
      } else if (text.includes("NotAuthorized")) {
        console.log(`  ❌ NotAuthorized - SSID invalid or expired`);
        clearTimeout(timeout);
        ws.close();
        resolve(false);
      }
    });

    ws.on("close", () => {
      clearTimeout(timeout);
      if (!authenticated) {
        console.log(`  ❌ WebSocket closed before auth`);
      }
      resolve(authenticated);
    });

    ws.on("error", (err) => {
      console.log(`  ❌ WebSocket error: ${err.message}`);
      clearTimeout(timeout);
      resolve(false);
    });
  });
}

async function testWithUpgrade(host, ssid, prefetchedCookies) {
  return new Promise((resolve) => {
    // Step 1: HTTP Polling Open
    const pollReq = https.get({
      hostname: host,
      path: `/socket.io/?EIO=4&transport=polling&t=${Date.now()}`,
      method: "GET",
      headers: {
        ...HTTP_HEADERS,
        Host: host,
        ...(prefetchedCookies.length > 0 ? { Cookie: prefetchedCookies.join("; ") } : {}),
      },
    }, (res) => {
      let body = "";
      res.on("data", (chunk) => { body += chunk.toString(); });
      res.on("end", () => {
        if (res.statusCode !== 200) {
          console.log(`  ❌ HTTP polling failed: ${res.statusCode}`);
          resolve(false);
          return;
        }

        try {
          const parsed = JSON.parse(body.substring(1));
          const sid = parsed.sid;
          const pollCookies = (res.headers["set-cookie"] || []).map((c) => c.split(";")[0]);

          if (!sid) {
            console.log(`  ❌ No SID in polling response`);
            resolve(false);
            return;
          }

          console.log(`  📡 HTTP polling OK (SID: ${sid.substring(0, 8)}..., ${pollCookies.length} new cookies)`);

          // Step 2: Upgrade to WebSocket with SID
          const wsUrl = `wss://${host}/socket.io/?EIO=4&transport=websocket&sid=${encodeURIComponent(sid)}`;
          const allCookies = [...prefetchedCookies, ...pollCookies];
          const wsHeaders = {
            ...WS_HEADERS,
            ...(allCookies.length > 0 ? { Cookie: allCookies.join("; ") } : {}),
          };

          let authenticated = false;
          const timeout = setTimeout(() => {
            console.log(`  ❌ WebSocket upgrade timeout after 15s`);
            ws.close();
            resolve(false);
          }, 15000);

          const ws = new WebSocket(wsUrl, { headers: wsHeaders, perMessageDeflate: false });

          ws.on("open", () => {
            console.log(`  📡 WebSocket UPGRADED (with SID)`);
          });

          ws.on("message", (raw) => {
            const text = typeof raw === "string" ? raw : raw.toString("utf8");

            if (text.startsWith("0")) {
              console.log(`  🔌 Engine.IO OPEN`);
            } else if (text.startsWith("40")) {
              console.log(`  🔐 Socket.IO CONNECT, sending auth...`);
              const authMessage = '42' + JSON.stringify([
                "auth",
                {
                  session: ssid,
                  isDemo: 1,
                  uid: 0,
                  platform: 2,
                  isFastHistory: true,
                  isOptimized: true
                }
              ]);
              ws.send(authMessage);
            } else if (text.startsWith("42") && text.includes("successauth")) {
              console.log(`  ✅ AUTHENTICATED!`);
              authenticated = true;
              clearTimeout(timeout);
              ws.close();
              resolve(true);
            } else if (text.includes("NotAuthorized")) {
              console.log(`  ❌ NotAuthorized`);
              clearTimeout(timeout);
              ws.close();
              resolve(false);
            }
          });

          ws.on("close", () => {
            clearTimeout(timeout);
            resolve(authenticated);
          });

          ws.on("error", (err) => {
            console.log(`  ❌ Error: ${err.message}`);
            clearTimeout(timeout);
            resolve(false);
          });
        } catch (err) {
          console.log(`  ❌ Polling parse error: ${err.message}`);
          resolve(false);
        }
      });
    });

    pollReq.on("error", (err) => {
      console.log(`  ❌ HTTP polling error: ${err.message}`);
      resolve(false);
    });

    pollReq.setTimeout(10000, () => {
      pollReq.destroy();
      console.log(`  ❌ HTTP polling timeout`);
      resolve(false);
    });
  });
}

async function main() {
  const ssid = process.argv[2];
  if (!ssid || ssid === "YOUR_SSID") {
    console.error("Usage: node test-po.js <SSID>");
    console.error("Example: node test-po.js '42[\"auth\",{\"session\":\"abc123\"}]'");
    process.exit(1);
  }

  console.log(`🔍 PocketOption WebSocket Diagnostic\n`);
  console.log(`SSID: ${ssid.substring(0, 50)}...\n`);

  console.log(`1️⃣  Discovering reachable hosts...\n`);
  const hostResults = await Promise.all(DEMO_HOSTS.map(testHostReachable));
  const reachableHosts = hostResults.filter(h => h.sid);

  if (reachableHosts.length === 0) {
    console.log(`❌ No hosts reachable! Check network.\n`);
    process.exit(1);
  }

  console.log(`\n2️⃣  Testing WebSocket connections...\n`);

  let success = false;
  for (const hostData of reachableHosts) {
    const { host, sid, cookies } = hostData;
    console.log(`\n📍 Host: ${host}`);

    console.log(`  Testing DIRECT WebSocket...`);
    if (await testDirectWebSocket(host, ssid, cookies)) {
      success = true;
      break;
    }

    console.log(`  Testing UPGRADE WebSocket...`);
    if (await testWithUpgrade(host, ssid, cookies)) {
      success = true;
      break;
    }
  }

  console.log(`\n${"=".repeat(60)}`);
  if (success) {
    console.log(`✅ SUCCESS! WebSocket connection and auth verified.\n`);
    console.log(`The connection should now receive candle data.\n`);
    process.exit(0);
  } else {
    console.log(`❌ FAILED! Could not authenticate on any host.\n`);
    console.log(`Possible causes:\n`);
    console.log(`  - SSID is invalid or expired\n`);
    console.log(`  - Cloudflare is blocking the connection\n`);
    console.log(`  - Network connectivity issue\n`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(`\n❌ Fatal error: ${err.message}\n`);
  process.exit(1);
});
