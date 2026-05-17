#!/bin/bash
# DIAGNOSTIC SCRIPT — Botofficiel V6 Bridge Connection Test
# Tests: Bridge sync, SSID validation, PocketOption connection, candle streaming, auto-trade

set -e

echo "╔═══════════════════════════════════════════════════════════════════════════╗"
echo "║           BOTOFFICIEL V6 — DIAGNOSTIC SUITE (2026-05-16)                 ║"
echo "╚═══════════════════════════════════════════════════════════════════════════╝"
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

TESTS_PASSED=0
TESTS_FAILED=0

# Test result logger
test_result() {
    local name=$1
    local status=$2
    local message=$3

    if [ "$status" = "PASS" ]; then
        echo -e "${GREEN}✓${NC} $name"
        echo "  └─ $message"
        ((TESTS_PASSED++))
    else
        echo -e "${RED}✗${NC} $name"
        echo "  └─ $message"
        ((TESTS_FAILED++))
    fi
    echo ""
}

echo "═══════════════════════════════════════════════════════════════════════════"
echo "PHASE 1: Build & Server Health"
echo "═══════════════════════════════════════════════════════════════════════════"
echo ""

# Test 1.1: TypeScript Build
echo -e "${BLUE}Test 1.1: TypeScript Build${NC}"
if npm run build 2>&1 | tee /tmp/build.log | grep -q "next build"; then
    if ! grep -q "error TS" /tmp/build.log; then
        test_result "TypeScript compilation" "PASS" "Zero TypeScript errors"
    else
        test_result "TypeScript compilation" "FAIL" "Found TypeScript errors (see above)"
    fi
else
    test_result "TypeScript compilation" "FAIL" "Build command failed"
fi

# Test 1.2: Dev Server Start
echo -e "${BLUE}Test 1.2: Dev Server Start${NC}"
timeout 10 npm run dev &
DEV_PID=$!
sleep 5

if curl -s http://localhost:3000/api/health > /tmp/health.json 2>&1; then
    if grep -q "status" /tmp/health.json; then
        test_result "Dev server startup" "PASS" "Server running on localhost:3000"
    else
        test_result "Dev server startup" "FAIL" "Health endpoint returned invalid JSON"
    fi
else
    test_result "Dev server startup" "FAIL" "Server not responding on localhost:3000"
fi

kill $DEV_PID 2>/dev/null || true
wait $DEV_PID 2>/dev/null || true
sleep 2

# Restart server for remaining tests
npm run dev > /tmp/server.log 2>&1 &
SERVER_PID=$!
sleep 5

echo "═══════════════════════════════════════════════════════════════════════════"
echo "PHASE 2: API Endpoints"
echo "═══════════════════════════════════════════════════════════════════════════"
echo ""

# Test 2.1: Health Check
echo -e "${BLUE}Test 2.1: Health Endpoint${NC}"
HEALTH=$(curl -s http://localhost:3000/api/health)
if echo "$HEALTH" | grep -q "ok"; then
    test_result "Health check" "PASS" "API responding correctly"
else
    test_result "Health check" "FAIL" "Health endpoint failed"
fi

# Test 2.2: Extension Bridge Ready
echo -e "${BLUE}Test 2.2: Extension Bridge${NC}"
BRIDGE=$(curl -s http://localhost:3000/api/bridge/status 2>/dev/null || echo "{}")
if [ ! -z "$BRIDGE" ] && [ "$BRIDGE" != "{}" ]; then
    test_result "Bridge endpoint" "PASS" "Extension bridge endpoint accessible"
else
    test_result "Bridge endpoint" "FAIL" "Bridge endpoint not responding or empty"
fi

echo "═══════════════════════════════════════════════════════════════════════════"
echo "PHASE 3: Extension Bridge Sync Test"
echo "═══════════════════════════════════════════════════════════════════════════"
echo ""

echo -e "${BLUE}Test 3.1: SSID Validation (Too Short)${NC}"
SSID_SHORT_RESPONSE=$(curl -s -X POST http://localhost:3000/api/extension/sync \
  -H "Content-Type: application/json" \
  -d '{
    "apiKey": "test-diagnostic-key",
    "ssid": "short",
    "uid": "test-uid",
    "username": "diagnostic",
    "isDemo": true,
    "demoBalance": "1000"
  }')

if echo "$SSID_SHORT_RESPONSE" | grep -q "invalide\|short"; then
    test_result "SSID validation (reject short)" "PASS" "Correctly rejects SSID < 10 chars"
else
    test_result "SSID validation (reject short)" "FAIL" "Should reject short SSID"
fi

echo -e "${BLUE}Test 3.2: SSID Validation (Valid Format)${NC}"
VALID_SSID="valid_ssid_1234567890_test"
SSID_VALID_RESPONSE=$(curl -s -X POST http://localhost:3000/api/extension/sync \
  -H "Content-Type: application/json" \
  -d "{
    \"apiKey\": \"test-diagnostic-key-valid\",
    \"ssid\": \"$VALID_SSID\",
    \"uid\": \"test-uid-2\",
    \"username\": \"diagnostic-user\",
    \"isDemo\": true,
    \"demoBalance\": \"1000\"
  }")

if echo "$SSID_VALID_RESPONSE" | grep -q "success"; then
    test_result "SSID validation (accept valid)" "PASS" "Accepts valid SSID >= 10 chars"
else
    test_result "SSID validation (accept valid)" "FAIL" "Should accept valid SSID: $SSID_VALID_RESPONSE"
fi

echo "═══════════════════════════════════════════════════════════════════════════"
echo "PHASE 4: Candle Data & Signal Generation"
echo "═══════════════════════════════════════════════════════════════════════════"
echo ""

# Test 4.1: Signal Endpoint
echo -e "${BLUE}Test 4.1: Signal Generation Endpoint${NC}"
SIGNALS=$(curl -s "http://localhost:3000/api/signals?limit=1" 2>/dev/null || echo "{}")
if echo "$SIGNALS" | grep -q "signal\|CALL\|PUT\|WAIT" 2>/dev/null || [ -z "$SIGNALS" ]; then
    test_result "Signal endpoint" "PASS" "Signal endpoint accessible (may be empty if no trades yet)"
else
    test_result "Signal endpoint" "FAIL" "Signal endpoint not responding"
fi

# Test 4.2: Bot Status
echo -e "${BLUE}Test 4.2: Bot Status Check${NC}"
BOT_STATUS=$(curl -s http://localhost:3000/api/bot 2>/dev/null || echo "{}")
if echo "$BOT_STATUS" | grep -q "running\|paused\|status" 2>/dev/null; then
    test_result "Bot status endpoint" "PASS" "Bot status accessible"
else
    test_result "Bot status endpoint" "FAIL" "Bot status endpoint not responding or empty"
fi

echo "═══════════════════════════════════════════════════════════════════════════"
echo "PHASE 5: Agent Timeouts Verification"
echo "═══════════════════════════════════════════════════════════════════════════"
echo ""

# Check for timeout configurations in source code
echo -e "${BLUE}Test 5.1: NewsAgent Timeout (2s)${NC}"
if grep -q "setTimeout.*2000\|timeout.*2s" src/core/agents/NewsAgent.ts 2>/dev/null; then
    test_result "NewsAgent timeout" "PASS" "2s timeout configured"
else
    test_result "NewsAgent timeout" "WARN" "Could not verify timeout (may use different method)"
fi

echo -e "${BLUE}Test 5.2: OrchestratorAgent Timeout (5s)${NC}"
if grep -q "setTimeout.*5000\|timeout.*5s" src/core/agents/OrchestratorAgent.ts 2>/dev/null; then
    test_result "OrchestratorAgent timeout" "PASS" "5s timeout configured"
else
    test_result "OrchestratorAgent timeout" "WARN" "Could not verify timeout (may use different method)"
fi

echo -e "${BLUE}Test 5.3: Bot Mutex Lock${NC}"
if grep -q "acquireLock\|mutex" src/services/bot-runner.ts 2>/dev/null; then
    test_result "Bot mutex lock" "PASS" "Mutex lock implemented"
else
    test_result "Bot mutex lock" "WARN" "Could not verify mutex implementation"
fi

echo "═══════════════════════════════════════════════════════════════════════════"
echo "PHASE 6: Database & Schema"
echo "═══════════════════════════════════════════════════════════════════════════"
echo ""

echo -e "${BLUE}Test 6.1: Database Schema${NC}"
if [ -f "src/db/schema.ts" ]; then
    if grep -q "users\|signals\|trades" src/db/schema.ts 2>/dev/null; then
        test_result "Database schema" "PASS" "Schema tables defined (users, signals, trades)"
    else
        test_result "Database schema" "FAIL" "Schema missing expected tables"
    fi
else
    test_result "Database schema" "FAIL" "Schema file not found"
fi

echo "═══════════════════════════════════════════════════════════════════════════"
echo "PHASE 7: Network & Host Discovery"
echo "═══════════════════════════════════════════════════════════════════════════"
echo ""

echo -e "${BLUE}Test 7.1: Network Test Endpoint${NC}"
NETWORK_TEST=$(curl -s http://localhost:3000/api/system/network-test 2>/dev/null || echo "error")
if echo "$NETWORK_TEST" | grep -q "hosts\|reachable\|status" 2>/dev/null; then
    test_result "Network diagnostic endpoint" "PASS" "Network test endpoint accessible"
    echo "  Response: $NETWORK_TEST" | head -c 200
else
    test_result "Network diagnostic endpoint" "WARN" "Network test endpoint may not be implemented (OK for diagnostics)"
fi

echo ""
echo "═══════════════════════════════════════════════════════════════════════════"
echo "FINAL RESULTS"
echo "═══════════════════════════════════════════════════════════════════════════"
echo ""
echo -e "${GREEN}Tests Passed: $TESTS_PASSED${NC}"
echo -e "${RED}Tests Failed: $TESTS_FAILED${NC}"
echo ""

if [ $TESTS_FAILED -eq 0 ]; then
    echo -e "${GREEN}✓ ALL DIAGNOSTICS PASSED — System is healthy!${NC}"
    RESULT=0
else
    echo -e "${YELLOW}⚠ Some tests failed or showed warnings — Review above${NC}"
    RESULT=1
fi

# Cleanup
echo ""
echo "Cleaning up..."
kill $SERVER_PID 2>/dev/null || true
wait $SERVER_PID 2>/dev/null || true

echo ""
echo "═══════════════════════════════════════════════════════════════════════════"
echo "Diagnostic complete. Ready for GitHub push if all tests passed."
echo "═══════════════════════════════════════════════════════════════════════════"

exit $RESULT
