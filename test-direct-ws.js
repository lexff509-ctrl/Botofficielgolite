#!/usr/bin/env node

/**
 * Test direct WebSocket without HTTP polling
 * Useful for debugging Engine.IO session handling
 */

const WebSocket = require("ws");

const CHROME_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const WS_HEADERS = {
  "User-Agent": CHROME_UA,
  "Origin": "https://pocketoption.com",
  "Cache-Control": "no-cache",
  "Accept-Language": "en-US,en;q=0.9,fr;q=0.8",
  "Sec-WebSocket-Version": "13",
};

async function testDirectWS(host, sessionToken) {
  return new Promise((resolve) => {
    // Direct WebSocket WITHOUT SID (fresh session)
    const wsUrl = `wss://${host}/socket.io/?EIO=4&transport=websocket`;

    console.log(`\n📡 Testing DIRECT WebSocket (no polling)\n`);
    console.log(`URL: ${wsUrl}\n`);

    let phase = "INIT";
    let success = false;
    const timeout = setTimeout(() => {
      console.log(`⏱️  Timeout after 20s in phase: ${phase}`);
      ws.close();
      resolve(false);
    }, 20000);

    const ws = new WebSocket(wsUrl, { headers: WS_HEADERS, perMessageDeflate: false });

    ws.on("open", () => {
      console.log(`✅ WebSocket OPEN`);
      phase = "OPEN";
    });

    ws.on("message", (raw) => {
      const text = typeof raw === "string" ? raw : raw.toString("utf8");
      console.log(`📨 ${text.substring(0, 100)}${text.length > 100 ? "..." : ""}`);

      if (text.startsWith("0")) {
        console.log(`   → Engine.IO OPEN (creating session)`);
        phase = "ENGINE_OPEN";
        // Send Socket.IO CONNECT after Engine.IO is ready
        ws.send("40");
        console.log(`   ↗️  Sent: 40 (Socket.IO CONNECT)`);
        phase = "SOCKET_CONNECT_SENT";
      } else if (text.startsWith("40")) {
        console.log(`   → Socket.IO CONNECT ACK`);
        phase = "SOCKET_OPEN";

        // Now send auth
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
        console.log(`   ↗️  Sent: auth message`);
        phase = "AUTH_SENT";
      } else if (text.startsWith("42") && text.includes("successauth")) {
        console.log(`   ✅ AUTHENTICATED!`);
        success = true;
        clearTimeout(timeout);
        ws.close();
        resolve(true);
      } else if (text.includes("NotAuthorized") || text.includes("ERR")) {
        console.log(`   ❌ Error or rejection`);
        clearTimeout(timeout);
        ws.close();
        resolve(false);
      }
    });

    ws.on("close", (code, reason) => {
      console.log(`\n🔌 WebSocket closed (code: ${code}, reason: ${reason || "unknown"})`);
      console.log(`   Phase: ${phase}`);
      console.log(`   Success: ${success ? "YES ✅" : "NO ❌"}`);
      clearTimeout(timeout);
      resolve(success);
    });

    ws.on("error", (err) => {
      console.log(`\n❌ Error: ${err.message}`);
      clearTimeout(timeout);
      resolve(false);
    });

    ws.on("unexpected-response", (req, res) => {
      console.log(`\n⚠️  Unexpected HTTP response`);
      console.log(`   Status: ${res.statusCode}`);
      let body = "";
      res.on("data", (chunk) => { body += chunk.toString(); });
      res.on("end", () => {
        if (body) console.log(`   Body: ${body}`);
        clearTimeout(timeout);
        resolve(false);
      });
    });
  });
}

async function main() {
  const sessionToken = process.argv[2] || "test-token";
  const host = process.argv[3] || "api-eu.po.market";

  console.log(`🧪 Direct WebSocket Test (No HTTP Polling)\n`);
  console.log(`Session Token: ${sessionToken.substring(0, 30)}...`);
  console.log(`Target Host: ${host}`);

  const success = await testDirectWS(host, sessionToken);

  console.log(`\n${"=".repeat(60)}`);
  if (success) {
    console.log(`✅ SUCCESS! Direct WebSocket connection works!\n`);
  } else {
    console.log(`❌ FAILED! Direct WebSocket doesn't work.\n`);
  }
}

main().catch(console.error);
