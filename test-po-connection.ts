import { PocketOptionClient } from "./src/lib/pocketoption/client";

/**
 * Diagnostic test for PocketOption WebSocket connection
 * Usage: npx ts-node test-po-connection.ts YOUR_SSID
 */

async function testConnection() {
  const ssid = process.argv[2];
  if (!ssid) {
    console.error("Usage: npx ts-node test-po-connection.ts <SSID>");
    process.exit(1);
  }

  console.log("🔍 Starting PocketOption Connection Diagnostic...\n");

  const client = new PocketOptionClient(ssid, true);

  // Monitor connection state changes
  let stateChanges = 0;
  client.onAuth(() => {
    console.log("✅ [SUCCESS] Authentication successful!");
    stateChanges++;
  });

  client.onBalance((bal) => {
    console.log(`💰 Balance: ${bal.balance} (isDemo: ${bal.isDemo})`);
  });

  client.onError((err) => {
    console.error(`❌ [ERROR] ${err.message}`);
  });

  client.onSsidExpired(() => {
    console.error(`❌ [CRITICAL] SSID expired or invalid!`);
  });

  // Subscribe to candles
  const unsubCandle = client.onCandle("EURUSD", (candle) => {
    console.log(`📊 Candle: ${candle.asset} @ ${candle.timestamp} - O:${candle.open} H:${candle.high} L:${candle.low} C:${candle.close}`);
  }, 60);

  try {
    console.log("📡 Attempting connection...");
    await client.connect(true);
    console.log("✅ Connected to WebSocket\n");

    // Request candle history
    console.log("📚 Requesting candle history...");
    const candles = await client.requestCandleHistory("EURUSD", 60, 10);
    console.log(`✅ Got ${candles.length} candles\n`);

    // Wait 10 seconds for live candles
    console.log("⏳ Listening for live candles (10s timeout)...");
    await new Promise(r => setTimeout(r, 10000));

    // Get balance
    const balance = await client.getBalance();
    console.log(`💰 Final Balance:`, balance);

    // Get trade history
    const history = await client.getTradeHistory();
    console.log(`📋 Trade History (${history.length} trades)`);

    // Get monitor stats
    const stats = client.getMonitorStats();
    console.log(`\n📊 Connection Stats:`, stats);

  } catch (err: any) {
    console.error(`\n❌ Connection failed: ${err.message}`);
    console.error(`State: ${client.state}`);
    console.error(`Is Connected: ${client.isConnected}`);
  } finally {
    unsubCandle();
    client.disconnect();
    process.exit(0);
  }
}

testConnection().catch(console.error);
