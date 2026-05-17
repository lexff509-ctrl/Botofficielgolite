# 🔧 WebSocket Handshake Fix - Complete Implementation Guide

## Problem Overview

**Error:** `WebSocket upgrade error: Unexpected server response: 400`

**Root Cause:** 3 bugs in the handshake sequence that break Engine.IO v4 compliance:

1. **Cookies malformed** — no validation before transmission
2. **SID not URL-encoded** — base64 chars (`+`, `/`, `=`) break the query string
3. **Engine.IO probe phase skipped** — connects before server probe completes

---

## Architecture: Robust Real-Time Session Sync

### Flow Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│ Chrome Extension                                                 │
│ • Fetches cookies from page                                      │
│ • Captures SSID/session token                                    │
│ • Syncs mode (DEMO/LIVE)                                         │
└──────────────────┬──────────────────────────────────────────────┘
                   │ POST /api/extension/sync
                   ▼
┌─────────────────────────────────────────────────────────────────┐
│ Bridge (Extension Sync Route)                                    │
│ • Validates API Key                                              │
│ • Validates SSID format (min 10 chars)                           │
│ • Stores encrypted SSID in DB                                    │
│ • Calls ConnectionManager.refreshSession()                       │
└──────────────────┬──────────────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────────────────┐
│ ConnectionManager (State Machine)                                │
│ • IDLE → CONNECTING → READY                                      │
│ • Auto-reconnect with exponential backoff (5s, 10s, 20s...)      │
│ • Detects dead sessions (no pong for 35s)                        │
│ • Rejects BLOCKED state (waits for Bridge refresh)               │
└──────────────────┬──────────────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────────────────┐
│ PocketOptionClient (WebSocket)                                   │
│ PHASE 1: HTTP Polling                                            │
│   GET /socket.io/?EIO=4&transport=polling                        │
│   ✓ Validates + cleans cookies (BUG FIX #1)                      │
│   ✓ Receives sid + Engine.IO headers                             │
│                                                                  │
│ PHASE 2: WebSocket Upgrade                                       │
│   wss://host/socket.io/?EIO=4&transport=websocket&sid=...        │
│   ✓ Encodes sid for URL (BUG FIX #2)                             │
│   ✓ Awaits "3probe" from server                                  │
│   ✓ Sends "5" probe response (BUG FIX #3)                        │
│                                                                  │
│ PHASE 3: Socket.IO Handshake                                     │
│   Receives "40" (Socket.IO CONNECT ack)                          │
│   Sends   "42[\"auth\",{session:...,isDemo:...}]"                │
│   Receives "successauth" → READY                                 │
└──────────────────┬──────────────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────────────────┐
│ Real-Time Data                                                   │
│ • Candle stream (1m, 5m, etc)                                    │
│ • Balance updates (every 60s)                                    │
│ • Trade results                                                  │
│ • Account data                                                   │
└─────────────────────────────────────────────────────────────────┘
```

---

## Bug Fixes Applied

### BUG FIX #1: Cookie Validation

**File:** `src/lib/pocketoption/client.ts`

**Method:** `_validateAndCleanCookies()`

**Why:** Cookies from extension can contain:
- Malformed key=value pairs
- Control characters (newlines, tabs)
- Duplicates
- Empty values

```typescript
private _validateAndCleanCookies(cookies: string[]): string[] {
  const validated: string[] = [];
  const seen = new Set<string>();

  for (const cookie of cookies) {
    if (!cookie || typeof cookie !== "string") continue;
    
    const trimmed = cookie.trim();
    if (!trimmed || !trimmed.includes("=")) continue;
    
    // Check for control chars that break HTTP headers
    if (/[\r\n\x00-\x08\x0b\x0c\x0e-\x1f]/.test(trimmed)) {
      console.warn(`[PO] Skipping cookie with control chars`);
      continue;
    }

    const key = trimmed.split("=")[0].toLowerCase();
    if (seen.has(key)) continue; // Skip duplicates

    validated.push(trimmed);
    seen.add(key);
  }

  return validated;
}
```

### BUG FIX #2: SID URL Encoding

**File:** `src/lib/pocketoption/client.ts`

**Method:** `connectWithUpgrade()`

**Why:** Base64 sid contains `+`, `/`, `=` which are special in URLs:
- `+` becomes space
- `/` becomes path separator
- `=` becomes query delimiter

```typescript
// BEFORE (❌ BROKEN):
const wsUrl = `wss://${host}/socket.io/?EIO=4&transport=websocket&sid=${sid}`;

// AFTER (✅ FIXED):
const encodedSid = encodeURIComponent(sid);
const wsUrl = `wss://${host}/socket.io/?EIO=4&transport=websocket&sid=${encodedSid}`;
```

### BUG FIX #3: Engine.IO Probe Phase

**File:** `src/lib/pocketoption/client.ts`

**Method:** `connectWithUpgrade()`

**Why:** Engine.IO v4 requires strict sequence:
1. Server sends `"3probe"`
2. Client responds `"5"`
3. THEN client can send Socket.IO `"40"`

```typescript
let probePhaseComplete = false;

ws.on("message", (raw: WebSocket.Data) => {
  const text = Buffer.isBuffer(raw) ? raw.toString("utf8") : String(raw);

  // Handle probe BEFORE general message handler
  if (text === "3probe" && !probePhaseComplete) {
    console.log("[PO] Received Engine.IO probe, responding with 5");
    ws.send("5");
    probePhaseComplete = true;
    return; // Don't pass to handleRawMessage
  }

  this.handleRawMessage(raw);
});
```

---

## Testing & Validation

### 1. Run Diagnostic (Before Deploy)

```bash
# Create test file
cat > src/scripts/test-websocket-diagnostic.ts << 'EOF'
import { runFullDiagnostic } from "@/lib/pocketoption/connection-diagnostic";
import * as dotenv from "dotenv";

dotenv.config();

async function main() {
  const host = "demo-api-eu.po.market"; // Use actual host
  const cookies = [
    "PHPSESSID=your_session_token_here",
    "cf_clearance=your_clearance_here",
  ];
  const sessionToken = "your_session_token";
  const isDemo = true;

  await runFullDiagnostic(host, cookies, sessionToken, isDemo);
}

main().catch(console.error);
EOF

# Run diagnostic
npx ts-node src/scripts/test-websocket-diagnostic.ts
```

**Expected Output:**

```
[WS-Diagnostic] ✅ HTTP-Polling-URL { host: 'demo-api-eu.po.market', ... }
[WS-Diagnostic] ✅ HTTP-Polling-Response { statusCode: 200, ... }
[WS-Diagnostic] ✅ HTTP-Polling-Sid { sid: 'abc123...', ... }
[WS-Diagnostic] ✅ WebSocket-URL { url: 'wss://...&sid=abc123...', ... }
[WS-Diagnostic] ✅ WebSocket-Open { readyState: 1 }
[WS-Diagnostic] ✅ WebSocket-Message-1 { firstChar: '3', preview: '3probe' }
[WS-Diagnostic] ✅ Engine.IO-Probe-Received { message: '3probe' }
[WS-Diagnostic] ✅ Engine.IO-Probe-Response { sent: '5' }
[WS-Diagnostic] ✅ WebSocket-Message-2 { firstChar: '0', ... }
[WS-Diagnostic] ✅ Engine.IO-Open { message: '0{...}' }
[WS-Diagnostic] ✅ SocketIO-Auth-SendConnect { sent: '40' }
[WS-Diagnostic] ✅ SocketIO-Auth-Success { message: '42["successauth",...]' }
```

### 2. Integration Test (Local)

```bash
# Start dev server
npm run dev

# In another terminal, test sync endpoint
curl -X POST http://localhost:3000/api/extension/sync \
  -H "Content-Type: application/json" \
  -d '{
    "apiKey": "your_api_key",
    "ssid": "your_ssid_from_extension",
    "uid": "12345",
    "deviceName": "Test Browser",
    "isDemo": true,
    "demoBalance": "1000",
    "liveBalance": "5000",
    "username": "testuser"
  }'

# Check logs for:
# [ExtensionBridge] SSID synchronisé avec succès
# [ConnMgr] ✅ User {id} READY
```

### 3. Load Test (Reconnection)

```bash
# Simulate 5 reconnections with ConnectionManager
cat > src/scripts/test-reconnection.ts << 'EOF'
import { ensureConnected, getAllSessionStatus } from "@/services/network/PocketOptionConnectionManager";

async function main() {
  const userId = 123;
  const ssid = "test_ssid_here";
  const isDemo = true;

  for (let i = 0; i < 5; i++) {
    console.log(`\n[Test] Attempt ${i + 1}...`);
    const client = await ensureConnected(userId, ssid, isDemo);
    
    if (client && client.isConnected) {
      console.log(`✅ Connected`);
      console.log(`Status:`, getAllSessionStatus());
    } else {
      console.log(`❌ Connection failed`);
    }

    await new Promise(r => setTimeout(r, 3000));
  }
}

main().catch(console.error);
EOF

npx ts-node src/scripts/test-reconnection.ts
```

---

## Production Deployment Checklist

- [ ] Applied all 3 bug fixes
- [ ] Ran diagnostic test successfully
- [ ] Tested sync endpoint with real extension data
- [ ] Verified logs show "✅ User {id} READY"
- [ ] No "Unexpected server response: 400" errors
- [ ] ConnectionManager state transitions working
- [ ] Build passes: `npm run build`
- [ ] No TypeScript errors

---

## Architecture: Stable, Maintainable Design

### Session State Machine

```
IDLE
├─→ CONNECTING (await connect)
│   ├─→ READY (✅ auth success)
│   │   ├─→ RECONNECTING (error detected)
│   │   └─→ BLOCKED (SSID expired)
│   │
│   └─→ RECONNECTING (connection failed)
│       └─→ exponential backoff (5s, 10s, 20s, 40s, 60s)
│           └─ after 5 attempts → COOLDOWN (60s) then IDLE
│
└─→ BLOCKED (SSID expired, needs Bridge refresh)
    └─ waits for new SSID from /api/extension/sync
```

### Error Recovery Chain

```
WebSocket Error
  ↓
  ├─ "NotAuthorized" → BLOCKED (wait for Bridge)
  ├─ "Connection timeout" → RECONNECTING (exponential backoff)
  ├─ "Pong timeout > 35s" → RECONNECTING (zombie detection)
  └─ "Other error" → RECONNECTING
```

### Data Sync Flow

```
Extension Cookie Change
  ↓
POST /api/extension/sync
  ↓
Bridge validates SSID format
  ↓
Bridge calls ConnectionManager.refreshSession()
  ↓
ConnectionManager tears down old client
  ↓
ConnectionManager.ensureConnected() with new SSID
  ↓
Bot runner resumes/restarts with new connection
  ↓
✅ Real-time data flows
```

---

## Monitoring & Logging

### Key Logs to Watch

```
[PO] Cleaned cookies: 10 → 9  // Validation worked
[PO] Received Engine.IO probe, responding with 5  // Probe handled
[ConnMgr] ✅ User 123 READY  // Connected!
[PO] Pong timeout (35s silence)  // Zombie detected → auto-reconnect
[ConnMgr] SSID expired for user 123 → BLOCKED  // Wait for Bridge
```

### Debug Mode

```bash
# Enable detailed WebSocket logs
DEBUG=websocket* npm run dev

# Check connection state at any time:
# GET /api/admin/stats (check websocket status)
```

---

## Common Issues & Solutions

| Issue | Cause | Solution |
|-------|-------|----------|
| `400 Unexpected response` | Malformed cookies | Restart with validated cookies |
| `NotAuthorized` | SSID expired | Extension syncs fresh SSID |
| `Connection timeout` | Network blocking | Try different host (auto-rotate) |
| `Pong timeout` | Dead socket | Auto-reconnect via zombie detection |
| `0/15 hosts reachable` | Firewall blocking | Check Railway firewall rules |

---

## Next: Manual Testing

1. **Start dev server:** `npm run dev`
2. **Open extension:** point to `http://localhost:3000`
3. **Sync cookies:** click extension sync button
4. **Check logs:** verify `✅ User X READY` appears
5. **Check data:** verify balance/trades update in real-time

If all passes → ready for Railway deployment ✅
