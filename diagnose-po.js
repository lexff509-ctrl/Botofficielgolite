#!/usr/bin/env node

/**
 * Deep diagnostic for PocketOption WebSocket 400 error
 * Tests headers, cookies, and protocol requirements
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
};

const HTTP_HEADERS = {
  "User-Agent": CHROME_UA,
  "Origin": "https://pocketoption.com",
  "Referer": "https://pocketoption.com/",
  "Accept-Language": "en-US,en;q=0.9,fr;q=0.8",
  "Cache-Control": "no-cache",
};

async function diagnoseHost(host, sessionToken) {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`🔍 Diagnosing ${host}\n`);

  // Step 1: HTTP Polling
  console.log(`1️⃣  HTTP Polling Request\n`);

  const pollReq = await new Promise((resolve) => {
    const options = {
      hostname: host,
      path: `/socket.io/?EIO=4&transport=polling&t=${Date.now()}`,
      method: "GET",
      headers: {
        ...HTTP_HEADERS,
        Host: host,
      },
    };

    console.log(`GET /${options.path}`);
    console.log(`Host: ${host}`);

    const req = https.get(options, (res) => {
      console.log(`\n✅ Response Status: ${res.statusCode}`);
      console.log(`Headers:`);
      Object.entries(res.headers).forEach(([k, v]) => {
        if (k === "set-cookie") {
          console.log(`  ${k}: ${JSON.stringify(v)}`);
        } else if (!["date", "server", "cache-control", "expires"].includes(k)) {
          console.log(`  ${k}: ${v}`);
        }
      });

      let body = "";
      res.on("data", (chunk) => { body += chunk.toString(); });
      res.on("end", () => {
        try {
          const parsed = JSON.parse(body.substring(1));
          console.log(`\nParsed SID: ${parsed.sid.substring(0, 16)}...`);
          console.log(`Pinginterval: ${parsed.pingInterval}ms`);
          console.log(`PingtimeoutMs: ${parsed.pingTimeoutMs}ms`);

          const cookies = (res.headers["set-cookie"] || []).map((c) => c.split(";")[0]);
          resolve({ sid: parsed.sid, cookies, body });
        } catch (e) {
          console.log(`⚠️  Could not parse SID from response`);
          resolve({ sid: null, cookies: [], body });
        }
      });
    });

    req.on("error", (err) => {
      console.log(`❌ HTTP Error: ${err.message}`);
      resolve({ sid: null, cookies: [], body: "" });
    });

    req.setTimeout(5000, () => {
      req.destroy();
      console.log(`❌ HTTP Timeout`);
      resolve({ sid: null, cookies: [], body: "" });
    });
  });

  if (!pollReq.sid) {
    console.log(`\n⚠️  Failed to get SID, cannot proceed`);
    return;
  }

  // Step 2: WebSocket with full diagnostics
  console.log(`\n\n2️⃣  WebSocket Upgrade Request\n`);

  const wsUrl = `wss://${host}/socket.io/?EIO=4&transport=websocket&sid=${encodeURIComponent(pollReq.sid)}`;
  console.log(`URL: ${wsUrl}\n`);
  console.log(`Headers:`);

  const allCookies = pollReq.cookies;
  const wsHeaders = {
    ...WS_HEADERS,
    ...(allCookies.length > 0 ? { Cookie: allCookies.join("; ") } : {}),
  };

  Object.entries(wsHeaders).forEach(([k, v]) => {
    if (k === "Cookie") {
      console.log(`  ${k}: [${allCookies.length} cookies]`);
      allCookies.forEach((c) => console.log(`    - ${c}`));
    } else {
      console.log(`  ${k}: ${v}`);
    }
  });

  console.log(`\nperMessageDeflate: false`);

  const wsResult = await new Promise((resolve) => {
    let messages = [];
    let handshakeDone = false;

    const timeout = setTimeout(() => {
      console.log(`\n⚠️  WebSocket timeout (no handshake after 10s)`);
      resolve({ success: false, messages });
    }, 10000);

    const ws = new WebSocket(wsUrl, { headers: wsHeaders, perMessageDeflate: false });

    ws.on("open", () => {
      console.log(`\n✅ WebSocket OPEN`);
      handshakeDone = true;
    });

    ws.on("message", (raw) => {
      const text = typeof raw === "string" ? raw : raw.toString("utf8");
      messages.push(text);

      console.log(`\n📨 Received: ${text.substring(0, 80)}${text.length > 80 ? "..." : ""}`);

      if (text.startsWith("0")) {
        console.log(`   ✓ Engine.IO OPEN`);
        ws.send("40");
        console.log(`   ↗️  Sent: 40 (Socket.IO CONNECT)`);
      } else if (text.startsWith("40")) {
        console.log(`   ✓ Socket.IO CONNECT received`);
        const authMessage = '42' + JSON.stringify([
          "auth",
          {
            session: sessionToken,
            isDemo: 1,
            uid: 0,
            platform: 2,
            isFastHistory: true,
            isOptimized: true
          }
        ]);
        ws.send(authMessage);
        console.log(`   ↗️  Sent: auth message (${authMessage.length} bytes)`);
      } else if (text.startsWith("42") && text.includes("successauth")) {
        console.log(`   ✅ AUTHENTICATION SUCCESSFUL!`);
        clearTimeout(timeout);
        ws.close();
        resolve({ success: true, messages });
      } else if (text.includes("NotAuthorized")) {
        console.log(`   ❌ NotAuthorized response`);
        clearTimeout(timeout);
        ws.close();
        resolve({ success: false, messages });
      }
    });

    ws.on("close", (code, reason) => {
      console.log(`\n🔌 WebSocket closed (code: ${code}, reason: ${reason || "none"})`);
      clearTimeout(timeout);
      if (messages.length === 0) {
        console.log(`   ⚠️  No messages received`);
      }
      resolve({ success: false, messages });
    });

    ws.on("error", (err) => {
      console.log(`\n❌ WebSocket error: ${err.message}`);
      clearTimeout(timeout);
      resolve({ success: false, messages, error: err.message });
    });

    ws.on("unexpected-response", (req, res) => {
      console.log(`\n⚠️  Unexpected HTTP response during WebSocket upgrade`);
      console.log(`   Status: ${res.statusCode}`);
      console.log(`   Status Message: ${res.statusMessage}`);
      let body = "";
      res.on("data", (chunk) => { body += chunk.toString(); });
      res.on("end", () => {
        if (body) console.log(`   Body: ${body.substring(0, 200)}`);
        clearTimeout(timeout);
        resolve({ success: false, messages, httpError: res.statusCode });
      });
    });
  });

  console.log(`\n${"−".repeat(60)}`);
  if (wsResult.httpError === 400) {
    console.log(`\n⚠️  HTTP 400 Error Analysis:`);
    console.log(`   - Cloudflare rejecting the WebSocket upgrade`);
    console.log(`   - Possible causes:`);
    console.log(`     1. Missing or invalid headers`);
    console.log(`     2. Invalid SID format`);
    console.log(`     3. Invalid cookies`);
    console.log(`     4. Rate limiting`);
  } else if (!wsResult.success && wsResult.messages.length === 0) {
    console.log(`\n⚠️  No Connection Analysis:`);
    console.log(`   - Server not responding to WebSocket upgrade`);
    console.log(`   - Check: Network connectivity, firewall, rate limits`);
  }

  return wsResult;
}

async function main() {
  const sessionToken = process.argv[2] || "test-token";
  const host = process.argv[3] || "api-eu.po.market";

  console.log(`🔧 PocketOption Deep Diagnostic Tool\n`);
  console.log(`Session Token: ${sessionToken.substring(0, 30)}...`);
  console.log(`Target Host: ${host}\n`);

  const result = await diagnoseHost(host, sessionToken);

  console.log(`\n\n📊 Summary:`);
  console.log(`   Success: ${result.success ? "✅ YES" : "❌ NO"}`);
  console.log(`   Messages: ${result.messages.length}`);
  if (result.httpError) console.log(`   HTTP Error: ${result.httpError}`);
  if (result.error) console.log(`   Error: ${result.error}`);
}

main().catch(console.error);
