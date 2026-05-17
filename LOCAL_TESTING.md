# 🧪 LOCAL TESTING GUIDE — Before Railway Deployment

**Purpose:** Verify all fixes work correctly before deploying to Railway  
**Duration:** 30-60 minutes  
**Requirements:** Node.js 18+, PostgreSQL 14+, PocketOption account (optional)  

---

## 🎯 TEST OBJECTIVES

```
✓ Verify all 7 code fixes work correctly
✓ Test signal generation with fallbacks
✓ Validate error handling and timeouts
✓ Confirm database operations
✓ Check extension bridge integration
✓ Ensure bot auto-start/resume works
```

---

## 📋 PRE-TEST CHECKLIST

```
[ ] Code changes deployed locally (git pull)
[ ] Database migrations run (npm run db:migrate)
[ ] .env.local configured
[ ] PostgreSQL running
[ ] Node.js 18+ verified (node --version)
[ ] npm dependencies installed (npm install)
```

---

## 🏃 QUICK START (10 min)

### Step 1: Build & Start Server
```bash
cd /path/to/botofficiel

# Build
npm run build
# Expected: ✓ Success, zero TypeScript errors

# Start dev server
npm run dev
# Expected: ✓ Server running on localhost:3000
```

### Step 2: Verify Health Check
```bash
curl http://localhost:3000/api/health

# Expected response:
# {
#   "status": "ok",
#   "timestamp": "2026-05-16T...",
#   "environment": "development"
# }
```

**Result:** `✓ PASSED` | `✗ FAILED`

---

## 🧬 FIX #1: NewsAgent Timeout Test

**File:** `src/core/agents/NewsAgent.ts`

### Test 1.1: Verify Timeout Works
```bash
# Create test script
cat > test-news-timeout.js << 'EOF'
import { NewsAgent } from './src/core/agents/NewsAgent.ts';

const startTime = Date.now();
const result = await NewsAgent.analyze('EURUSD');
const elapsed = Date.now() - startTime;

console.log('Elapsed:', elapsed, 'ms');
console.log('Result:', result);
console.log('PASS' if elapsed < 3000 else 'FAIL: Timeout > 3s');
EOF

# Run via ts-node or build first
npm run build
node -r esbuild-register test-news-timeout.js
```

**Expected:**
- Elapsed: < 3000ms (2s timeout + 1s buffer)
- Result.sentiment: "NEUTRAL"
- Result.strength: 0
- Result.reason: "News circuit breaker" or "News unavailable"

**Result:** `✓ PASSED` | `✗ FAILED`

### Test 1.2: Verify Fallback on Error
```bash
# Manually simulate API failure
# Edit src/services/news.service.ts temporarily:
// throw new Error("Simulated API error");

# Then run:
const result = await NewsAgent.analyze('EURUSD');
console.log(result);
# Expected: sentiment="NEUTRAL", strength=0
```

**Result:** `✓ PASSED` | `✗ FAILED`

---

## 🎭 FIX #2: MarketSentimentAgent Circuit Breaker Test

**File:** `src/core/agents/MarketSentimentAgent.ts`

### Test 2.1: Circuit Breaker Activation
```bash
# Test script to trigger circuit breaker
cat > test-sentiment-cb.js << 'EOF'
import { MarketSentimentAgent } from './src/core/agents/MarketSentimentAgent.ts';

// Force 3 API failures to trigger circuit breaker
for (let i = 0; i < 4; i++) {
  console.log(`Attempt ${i + 1}...`);
  const result = await MarketSentimentAgent.analyze('BTCUSD', null, 50);
  console.log('Result:', result.bias, result.finalScore);
  await new Promise(r => setTimeout(r, 500));
}

// Expected: First 3 fail (API timeout), 4th uses circuit breaker cache
EOF
```

**Expected Logs:**
```
[Fear&Greed] API error (trip count: 1)
[Fear&Greed] API error (trip count: 2)
[Fear&Greed] API error (trip count: 3)
[Fear&Greed] Circuit breaker open — using cache or RSI fallback
```

**Result:** `✓ PASSED` | `✗ FAILED`

### Test 2.2: Verify RSI Fallback
```bash
# If circuit breaker triggered and cache empty, should use RSI
const result = await MarketSentimentAgent.analyze('BTCUSD', null, 75);
// RSI=75 (overbought) should give BULLISH sentiment

console.log('Bias:', result.bias);  // Expected: "BULLISH"
console.log('Sources:', result.sources.map(s => s.source));  // Should include "RSI-synthetic"
```

**Expected:**
- sources includes "RSI-synthetic"
- bias matches RSI direction

**Result:** `✓ PASSED` | `✗ FAILED`

---

## ⏱️ FIX #3: OrchestratorAgent Timeout Test

**File:** `src/core/agents/OrchestratorAgent.ts`

### Test 3.1: Timeout Path
```bash
# Create slow NewsAgent to trigger timeout
cat > test-orchestrator-timeout.js << 'EOF'
// Inject delay into NewsAgent
const mockNewsAgent = {
  analyze: () => new Promise(r => setTimeout(() => r({
    sentiment: 'NEUTRAL', strength: 0, reason: 'mocked'
  }), 10000))  // 10s delay > 5s timeout
};

// Mock it in OrchestratorAgent...
// (This requires code modification, so verify in logs instead)

const candles = [...]; // Sample candles
const result = await OrchestratorAgent.evaluate(candles, 'EURUSD', '5m');

console.log('Signal:', result.signal);
console.log('Reason:', result.reason);
// Expected: Falls back to Bollinger if timeout
EOF
```

**Expected:**
- signal: "BUY" | "SELL" | "WAIT" (not hung)
- reason includes "Fallback" or "Timeout"
- completes within 6s

**Result:** `✓ PASSED` | `✗ FAILED`

### Test 3.2: Normal Path (No Timeout)
```bash
# With real candles and fast agents
const fastCandles = [ /* >= 30 candles */ ];
const result = await OrchestratorAgent.evaluate(fastCandles, 'EURUSD', '5m');

console.log('Signal:', result.signal);
console.log('Confidence:', result.confidence);
// Expected: HIGH/MEDIUM/LOW with full analysis
```

**Result:** `✓ PASSED` | `✗ FAILED`

---

## 🔒 FIX #4: Mutex Lock Test

**File:** `src/services/bot-runner.ts:1002-1045`

### Test 4.1: Prevent Duplicate Bot Starts
```bash
# Simulate rapid bot starts
cat > test-mutex-lock.js << 'EOF'
import { startBotRunner, getBotRunner } from './src/services/bot-runner.ts';

const userId = 1;

// Start bot 1
const runner1 = startBotRunner({
  userId,
  botType: 'auto',
  asset: 'EURUSD',
  timeframe: '5m',
  mode: 'DEMO'
});

// Immediately start bot 2 (within 5s)
const runner2 = startBotRunner({
  userId,
  botType: 'auto',
  asset: 'EURUSD',
  timeframe: '5m',
  mode: 'DEMO'
});

console.log('Runner1 === Runner2?', runner1 === runner2);  // Expected: true
console.log('Bot instances:', 1);  // Should be 1, not 2

// Verify only 1 bot running
const active = getBotRunner(userId);
console.log('Active runners:', active ? 1 : 0);  // Expected: 1
EOF
```

**Expected Logs:**
```
[BotRunner] Mutex actif — démarrage dupliqué ignoré
```

**Result:** `✓ PASSED` | `✗ FAILED`

### Test 4.2: Verify Mutex Expires After 5s
```bash
// Start bot 1 at t=0
const r1 = startBotRunner({...});

// Wait 5.5 seconds
await new Promise(r => setTimeout(r, 5500));

// Try to start bot 2 (mutex expired)
const r2 = startBotRunner({...});

// Expected: Creates new bot (mutex expired)
console.log('Runner1 === Runner2?', r1 === r2);  // Expected: false (new bot created)
```

**Result:** `✓ PASSED` | `✗ FAILED`

---

## 💰 FIX #5: Balance Validation Test

**File:** `src/app/api/extension/sync/route.ts:139-180`

### Test 5.1: Validate With PO API
```bash
# Prepare mock extension sync request
cat > test-balance-validation.js << 'EOF'
const response = await fetch('http://localhost:3000/api/extension/sync', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    apiKey: 'test-key',
    ssid: 'real-ssid-here',
    uid: 'test-uid',
    username: 'testuser',
    isDemo: true,
    demoBalance: '1000',  // Extension says 1000
    liveBalance: '5000',
    deviceName: 'Test Browser'
  })
});

const result = await response.json();
console.log('Success:', result.success);
console.log('Message:', result.message);

// Check database
const user = await db.query('SELECT demo_balance FROM users WHERE extension_api_key = ?', ['test-key']);
console.log('Stored balance:', user[0].demo_balance);
// Should either match 1000 or use PO API value if connected
EOF
```

**Expected:**
- response.success: true
- Stored balance is reasonable (positive number)
- Logs show "[Balance Validation]" check

**Result:** `✓ PASSED` | `✗ FAILED`

### Test 5.2: Reject Mismatched Balance
```bash
// If PO API returns 500 but extension says 1000
// Expected: Use PO value (500) instead
// Check logs: [Balance Validation] Difference > 10%, using API value
```

**Result:** `✓ PASSED` | `✗ FAILED`

---

## 🔐 FIX #6: SSID Validation Test

**File:** `src/app/api/extension/sync/route.ts:87-94`

### Test 6.1: Reject Short SSID
```bash
curl -X POST http://localhost:3000/api/extension/sync \
  -H "Content-Type: application/json" \
  -d '{
    "apiKey": "test-key",
    "ssid": "short",  # Only 5 chars
    "uid": "test-uid",
    "username": "testuser",
    "isDemo": true,
    "demoBalance": "1000"
  }'

# Expected response:
# {
#   "error": "SSID invalide ou trop court",
#   "success": false
# }
# Status code: 400
```

**Result:** `✓ PASSED` | `✗ FAILED`

### Test 6.2: Accept Valid SSID
```bash
curl -X POST http://localhost:3000/api/extension/sync \
  -H "Content-Type: application/json" \
  -d '{
    "apiKey": "test-key",
    "ssid": "this_is_a_valid_ssid_1234567890",  # >10 chars
    "uid": "test-uid",
    "username": "testuser",
    "isDemo": true,
    "demoBalance": "1000"
  }'

# Expected response:
# {
#   "success": true,
#   "message": "Synchronisation réussie"
# }
# Status code: 200
```

**Result:** `✓ PASSED` | `✗ FAILED`

---

## 🔄 FIX #7: Reconnection Attempts Test

**File:** `src/services/bot-runner.ts:100`

### Test 7.1: Verify MAX_RECONNECT_ATTEMPTS = 15
```bash
# Check source code
grep "MAX_RECONNECT_ATTEMPTS" src/services/bot-runner.ts

# Expected output:
# private readonly MAX_RECONNECT_ATTEMPTS = 15;
```

**Result:** `✓ PASSED` | `✗ FAILED`

### Test 7.2: Observe Reconnection Behavior
```bash
# Start bot with no PO connection
const runner = startBotRunner({...});

// Monitor logs
// Expected:
// [BotRunner] Auto-reconnect: attempt 1/15...
// [BotRunner] Auto-reconnect: attempt 2/15...
// ... up to 15 attempts
// [BotRunner] Max reconnect attempts (15) reached — pausing bot
```

**Result:** `✓ PASSED` | `✗ FAILED`

---

## 📊 COMPREHENSIVE SIGNAL TEST

### Objective: Full Signal Generation with All Fixes

```bash
# 1. Start bot in signal mode (not auto)
const runner = startBotRunner({
  userId: 1,
  botType: 'signal',  # Just generate signals
  asset: 'EURUSD',
  timeframe: '5m',
  mode: 'DEMO'
});

# 2. Wait for a signal (usually < 30s per candle)
# Monitor logs for:
# [BotRunner] NOUVEAU SIGNAL DETECTE: ...
# [OrchestratorAgent] Signal: BUY|SELL|WAIT

# 3. Verify signal has all fields:
const signals = await db.query(
  'SELECT * FROM signals WHERE user_id = 1 ORDER BY created_at DESC LIMIT 1'
);
const signal = signals[0];

console.log('Signal fields:');
console.log('  signal:', signal.direction);         # CALL or PUT
console.log('  confidence:', signal.confidence);    # HIGH/MEDIUM/LOW
console.log('  reason:', signal.reason);            # Should include agent names
console.log('  timestamp:', signal.timestamp);      # Recent time
console.log('  asset:', signal.asset);              # EURUSD
console.log('  timeframe:', signal.timeframe);      # 5m
```

**Expected:**
```
✓ Signal generated within 60s
✓ All required fields populated
✓ Reason includes at least 1 agent name
✓ Confidence is HIGH/MEDIUM/LOW (not null)
✓ No errors in logs
```

**Result:** `✓ PASSED` | `✗ FAILED`

---

## ⚙️ FALLBACK TESTING (When PocketOption Unavailable)

### Test Objective: Verify fallbacks work without PO connection

```bash
# 1. Don't connect to PocketOption (no real SSID)
# 2. Start bot anyway
const runner = startBotRunner({...});

# 3. Expect:
# [BotRunner] Waiting for PO connection...
# [BotRunner] Zero candles for EURUSD. Will retry next tick.

# 4. After enough ticks:
# Should use fallback mechanisms:
# - OrchestratorAgent timeout → Bollinger-Stoch fallback
# - MarketSentimentAgent → RSI fallback
# - NewsAgent → NEUTRAL fallback

# 5. Signal should still generate (with LOW confidence)
const signal = ... // fetch from DB
console.log('Signal generated without PO:', signal ? '✓' : '✗');
```

**Expected:**
- Signals generate despite no PO connection
- Confidence is LOW but signal exists
- Logs show multiple fallbacks

**Result:** `✓ PASSED` | `✗ FAILED`

---

## 📈 PERFORMANCE BASELINE

After fixes, expect these metrics:

```
NewsAgent evaluation:         < 2.5s (2s timeout + margin)
MarketSentimentAgent:         < 3s (includes sub-agents)
OrchestratorAgent:            < 5.5s (5s timeout + margin)
Full signal pipeline:         < 10s (all agents sequential)
Bot tick loop:                < 2s per iteration

Database writes:              < 100ms
Extension bridge sync:        < 500ms
Bot start/resume:             < 1s
```

**Measurement Procedure:**
```bash
# Add timing logs (temporary)
console.time('NewsAgent');
const news = await NewsAgent.analyze(asset);
console.timeEnd('NewsAgent');
# Measure all critical paths

# Expected output examples:
# NewsAgent: 1234ms
# MarketSentimentAgent: 2567ms
# OrchestratorAgent: 4123ms
```

**Result:** `✓ PASSED` | `✗ FAILED`

---

## 🏁 TEST COMPLETION CHECKLIST

```
[ ] FIX #1: NewsAgent timeout (2s works, fallback returns NEUTRAL)
[ ] FIX #2: Circuit breaker activates after 3 failures
[ ] FIX #3: OrchestratorAgent timeout (5s), fallback to Bollinger
[ ] FIX #4: Mutex prevents duplicate bot starts
[ ] FIX #5: Balance validation checks against PO API
[ ] FIX #6: SSID validation rejects short SSIDs
[ ] FIX #7: MAX_RECONNECT_ATTEMPTS = 15 (verified in code)
[ ] Full signal pipeline generates signals
[ ] Fallback mechanisms work without PO connection
[ ] Performance meets baseline expectations
```

**Overall Result:** 
- `✅ ALL TESTS PASSED — Ready for Railway`
- `⚠️ SOME TESTS FAILED — Fix issues before deploying`
- `❌ CRITICAL FAILURES — Do not deploy`

---

## 🚀 NEXT STEPS

If all tests pass:
1. Run `git log` to verify fixes are committed
2. Push to GitHub
3. Follow DEPLOYMENT_RAILWAY.md for Railway deployment

If tests fail:
1. Check error logs carefully
2. Review FIXES_APPLIED.md for each failing test
3. Identify root cause
4. Fix code
5. Re-run test
6. Commit fix with message: `fix: [test-name] — [brief description]`

---

## 📞 TROUBLESHOOTING

### "NewsAgent still hanging despite timeout fix"
- **Check:** Is Promise.race implemented? grep "Promise.race" src/core/agents/NewsAgent.ts
- **Fix:** Ensure timeout resolves with fallback result, not rejection

### "Signal generation still fails"
- **Check:** Are candles loaded? [BotRunner] Candles: X (should be > 10)
- **Fix:** Use fallback data or skip test if PO unavailable

### "Bot won't start (mutex lock?)"
- **Check:** Search logs for "Mutex actif"
- **Fix:** Wait 5.5s and try again (TTL expires)

### "Balance validation throwing errors"
- **Check:** Is PO client connected? poClient.isConnected
- **Fix:** Make fallback more robust (always validate, never reject)

---

**Test Guide Owner:** Engineering  
**Last Updated:** 2026-05-16  
**Questions:** Check logs first, then review FIXES_APPLIED.md

---

## 🆕 ADDITIONAL TESTS (May 2026)

### Test 8: Orphan Trade Cleanup

**File:** `src/services/orphan-trade-cleanup.service.ts`

#### Test 8.1: Manual Cleanup Endpoint

```bash
# Insert test PENDING trade > 10 minutes old
psql -d botofficiel_dev -c "
  INSERT INTO trades (user_id, mode, asset, direction, amount, timeframe, result, opened_at)
  VALUES (1, 'DEMO', 'EUR/USD', 'CALL', 1, '1m', 'PENDING', NOW() - INTERVAL '15 minutes')
  RETURNING id;"

# Get the trade ID, then cleanup
curl -X POST http://localhost:3000/api/trades/cleanup \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"

# Expected response:
# {
#   "message": "1 trade(s) orphelin(s) nettoyé(s)",
#   "cleaned": 1,
#   "trades": [{ "id": 1, "asset": "EUR/USD", "direction": "CALL", "amount": "1.00", "openedAt": "..." }]
# }

# Verify trade is marked as LOSS
psql -d botofficiel_dev -c "
  SELECT result, profit, closed_at FROM trades WHERE id = <trade_id>"
# Expected: result=LOSS, profit=0, closed_at=NOW()
```

**Result:** `✓ PASSED` | `✗ FAILED`

#### Test 8.2: Automatic Cleanup Service

```bash
# Cleanup runs automatically every 5 minutes on server startup
# Check logs for:
grep "\[OrphanTradeCleanup\]" logs/app.log

# Expected output:
# [OrphanTradeCleanup] Starting automatic orphan trade cleanup service
# [OrphanTradeCleanup] Cleaned 0 orphan trades (runs every 5 min)
```

**Result:** `✓ PASSED` | `✗ FAILED`

---

### Test 9: SSID Refresh Endpoint

**File:** `src/app/api/auth/ssid-refresh/route.ts`

#### Test 9.1: Check SSID Status

```bash
curl -X GET http://localhost:3000/api/auth/ssid-refresh \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"

# Expected response:
# {
#   "ssidStatus": "VALID" | "EXPIRED" | "UNKNOWN" | "NOT_SET",
#   "lastUpdated": "2026-05-17T10:30:00.000Z",
#   "hasPersonalSsid": true | false,
#   "suggestion": "Cliquez sur 'Resynchroniser SSID' pour mettre à jour" (if EXPIRED)
# }
```

**Result:** `✓ PASSED` | `✗ FAILED`

#### Test 9.2: Force SSID Refresh (DEMO Mode)

```bash
curl -X POST http://localhost:3000/api/auth/ssid-refresh \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{ "mode": "DEMO" }'

# Expected success response:
# {
#   "success": true,
#   "message": "SSID resynchronisé avec succès",
#   "ssidStatus": "VALID",
#   "mode": "DEMO"
# }

# Or expected failure (no SSID available):
# {
#   "success": false,
#   "error": "Aucun SSID disponible",
#   "ssidStatus": "UNKNOWN",
#   "suggestion": "Veuillez configurer un SSID personnel..."
# }
```

**Result:** `✓ PASSED` | `✗ FAILED`

---

### Test 10: Enhanced Balance Validation

**File:** `src/services/balance-validator.service.ts`

#### Test 10.1: Balance Check with Fallback

```bash
# Test balance validation with all sources
curl -X POST http://localhost:3000/api/trades \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "asset": "EUR/USD",
    "direction": "CALL",
    "amount": 1,
    "timeframe": "1m",
    "mode": "DEMO"
  }'

# Check server logs for balance validation:
grep "\[BalanceValidator\]" logs/app.log

# Expected output:
# [BalanceValidator] ✅ Solde validé: $9999.00 (source: db)
# [BalanceValidator] Multi-tier fallback: PO → cache → DB
```

**Result:** `✓ PASSED` | `✗ FAILED`

#### Test 10.2: Insufficient Balance Error

```bash
# Set demo balance to 0
psql -d botofficiel_dev -c "UPDATE users SET demo_balance = 0 WHERE id = 1"

# Try to trade
curl -X POST http://localhost:3000/api/trades \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "asset": "EUR/USD",
    "direction": "CALL",
    "amount": 1,
    "timeframe": "1m",
    "mode": "DEMO"
  }'

# Expected error response:
# {
#   "error": "Solde DEMO insuffisant: $0.00 < $1.00"
# }

# Restore balance
psql -d botofficiel_dev -c "UPDATE users SET demo_balance = 10000 WHERE id = 1"
```

**Result:** `✓ PASSED` | `✗ FAILED`

#### Test 10.3: Balance Cache (30s TTL)

```bash
# Trade 1 - balance from DB
curl -X POST http://localhost:3000/api/trades \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '...'
# Logs: source: db

# Immediately trade 2 - balance from cache
curl -X POST http://localhost:3000/api/trades \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '...'
# Logs: source: cache (30s TTL)

# Wait 35 seconds, trade 3 - balance from DB again
sleep 35
curl -X POST http://localhost:3000/api/trades \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '...'
# Logs: source: db (cache expired)
```

**Result:** `✓ PASSED` | `✗ FAILED`

---

## 📋 UPDATED TEST COMPLETION CHECKLIST

```
[ ] FIX #1: NewsAgent timeout (2s works, fallback returns NEUTRAL)
[ ] FIX #2: Circuit breaker activates after 3 failures
[ ] FIX #3: OrchestratorAgent timeout (5s), fallback to Bollinger
[ ] FIX #4: Mutex prevents duplicate bot starts
[ ] FIX #5: Balance validation checks against PO API
[ ] FIX #6: SSID validation rejects short SSIDs
[ ] FIX #7: MAX_RECONNECT_ATTEMPTS = 15 (verified in code)
[ ] TEST #8: Orphan trade cleanup works (manual & automatic)
[ ] TEST #9: SSID refresh endpoint responds correctly
[ ] TEST #10: Enhanced balance validation with fallback logic
[ ] Full signal pipeline generates signals
[ ] Fallback mechanisms work without PO connection
[ ] Performance meets baseline expectations
```

**Overall Result:** 
- `✅ ALL TESTS PASSED — Ready for Railway`
- `⚠️ SOME TESTS FAILED — Fix issues before deploying`
- `❌ CRITICAL FAILURES — Do not deploy`

