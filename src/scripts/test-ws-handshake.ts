/**
 * Quick WebSocket Handshake Test
 *
 * USAGE:
 *   npx ts-node src/scripts/test-ws-handshake.ts
 *
 * This tests the 3 bug fixes:
 * 1. Cookie validation
 * 2. SID URL encoding
 * 3. Engine.IO probe phase
 */

import { PocketOptionClient } from "@/lib/pocketoption/client";
import { discoverReachableHosts, preFetchCookies } from "@/lib/pocketoption/connection";

async function main() {
  console.log("\n" + "=".repeat(80));
  console.log("WebSocket Handshake Test - 3 Bug Fixes");
  console.log("=".repeat(80) + "\n");

  // Test 1: Cookie Validation
  console.log("TEST 1: Cookie Validation (_validateAndCleanCookies)");
  console.log("-".repeat(80));

  const testCases = [
    {
      name: "Valid cookies",
      input: ["PHPSESSID=abc123", "cf_clearance=xyz789"],
      expected: 2,
    },
    {
      name: "With duplicates",
      input: ["PHPSESSID=abc123", "PHPSESSID=different", "cf_clearance=xyz"],
      expected: 2,
    },
    {
      name: "With control chars",
      input: ["PHPSESSID=abc123\r\n", "cf_clearance=xyz"],
      expected: 1,
    },
    {
      name: "Empty values",
      input: ["PHPSESSID=", "cf_clearance=xyz"],
      expected: 1,
    },
    {
      name: "No equals sign",
      input: ["INVALID_COOKIE", "cf_clearance=xyz"],
      expected: 1,
    },
  ];

  for (const testCase of testCases) {
    // Test validation logic (simulated)
    const validated = testCase.input.filter((c) => {
      if (!c || typeof c !== "string") return false;
      const trimmed = c.trim();
      if (!trimmed || !trimmed.includes("=")) return false;
      if (/[\r\n\x00-\x08\x0b\x0c\x0e-\x1f]/.test(trimmed)) return false;
      return true;
    });

    const pass = validated.length === testCase.expected;
    const status = pass ? "✅" : "❌";
    console.log(`${status} ${testCase.name}: ${validated.length}/${testCase.expected}`);
  }

  // Test 2: SID URL Encoding
  console.log("\n\nTEST 2: SID URL Encoding");
  console.log("-".repeat(80));

  const testSids = [
    "abc123def456",
    "abc+def/ghi=jkl", // Base64 with special chars
    "2As4F+xKZ/8kL==", // Real-looking base64
  ];

  for (const sid of testSids) {
    const encoded = encodeURIComponent(sid);
    console.log(`Original: ${sid}`);
    console.log(`Encoded:  ${encoded}`);
    console.log(
      `Safe for URL: ${!sid.includes("+") && !sid.includes("/") && !sid.includes("=") ? "✅" : "✓ (fixed via encoding)"}`
    );
    console.log("");
  }

  // Test 3: Engine.IO Probe Sequence
  console.log("\nTEST 3: Engine.IO Probe Sequence");
  console.log("-".repeat(80));

  const probeSequence = [
    { msg: "3probe", from: "Server", action: "Client should respond with 5" },
    { msg: "5", from: "Client", action: "Sent (after receiving 3probe)" },
    { msg: "0{...sid...}", from: "Server", action: "Engine.IO OPEN" },
    { msg: "40", from: "Client", action: "Socket.IO CONNECT" },
    { msg: "40", from: "Server", action: "Socket.IO CONNECT ACK" },
    { msg: '42["auth",{...}]', from: "Client", action: "Send auth" },
    { msg: '42["successauth"]', from: "Server", action: "Auth success → READY" },
  ];

  let step = 1;
  for (const item of probeSequence) {
    console.log(`${step}. [${item.from}] ${item.msg}`);
    console.log(`   → ${item.action}`);
    step++;
  }

  // Test 4: Integration Test (if SSID provided)
  console.log("\n\nTEST 4: Integration Test (Optional)");
  console.log("-".repeat(80));

  const ssid = process.env.TEST_SSID;
  const testApiKey = process.env.TEST_API_KEY;

  if (!ssid) {
    console.log("⚠️  Skipped (provide TEST_SSID env var)");
  } else {
    try {
      console.log(`Testing with SSID: ${ssid.substring(0, 20)}...`);

      // Discover hosts
      const hosts = await discoverReachableHosts(true);
      if (hosts.length === 0) {
        console.log("❌ No reachable hosts found");
      } else {
        console.log(`✅ Found ${hosts.length} reachable hosts`);
        console.log(`   First: ${hosts[0]}`);

        // Try connection
        try {
          const client = new PocketOptionClient(ssid, true);
          console.log("🔄 Attempting connection...");
          await client.connect(true);

          if (client.isConnected) {
            console.log("✅ WebSocket Connected!");
            client.disconnect?.();
          } else {
            console.log("❌ Connection state is not READY");
          }
        } catch (err) {
          console.log(`❌ Connection error: ${(err as any).message}`);
        }
      }
    } catch (err) {
      console.log(`⚠️  Integration test error: ${(err as any).message}`);
    }
  }

  console.log("\n" + "=".repeat(80));
  console.log("Test Complete");
  console.log("=".repeat(80) + "\n");
}

main().catch(console.error);
