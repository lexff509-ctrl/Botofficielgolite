# 🔧 PocketOption WebSocket Connection - Diagnostic & Fixes

## 📋 Issues Found & Fixed

### ✅ **ISSUE 1: Missing SID in WebSocket Upgrade (CRITICAL)**
**File:** `src/lib/pocketoption/client.ts:456`
**Problem:** 
- HTTP polling obtains a SID (session ID) from the server
- WebSocket upgrade was NOT including this SID in the URL
- Server saw it as a completely new connection → no session context → auth fails
- Logs: `"Disconnected before READY"` during AUTHENTICATING phase

**Fix Applied:**
```typescript
// BEFORE
const wsUrl = `wss://${host}/socket.io/?EIO=4&transport=websocket`;

// AFTER  
const wsUrl = `wss://${host}/socket.io/?EIO=4&transport=websocket&sid=${encodeURIComponent(sid)}`;
```

---

### ✅ **ISSUE 2: Cloudflare Cookies Not Pre-fetched (CRITICAL)**
**File:** `src/lib/pocketoption/connection.ts:299`
**Problem:**
- `preFetchCookies()` was fetching from `pocketoption.com` main domain
- Cloudflare sets session-specific cookies per API host (`api-eu.po.market`, etc.)
- Cookies from main domain ≠ cookies for API host → Cloudflare rejects connection

**Fix Applied:**
```typescript
// BEFORE: Fetched from pocketoption.com
const targetHost = "pocketoption.com";

// AFTER: Fetch from the specific API host
export async function preFetchCookies(host: string): Promise<CookieResult> {
  const options: https.RequestOptions = {
    hostname: host,  // ← NOW USES SPECIFIC HOST
    path: `/socket.io/?EIO=4&transport=polling&t=${Date.now()}`,
    // ... rest of config
  };
}
```

---

### ✅ **ISSUE 3: No Cookie Pre-fetch Before Connection (CRITICAL)**
**File:** `src/lib/pocketoption/client.ts:327`
**Problem:**
- `connect()` discovers hosts but never calls `preFetchCookies()`
- Cookies are only passed if they were provided in constructor
- Zero Cloudflare cookies → connection fails before auth

**Fix Applied:**
```typescript
// Added in connect() loop for each host:
for (const host of reachableHosts) {
  console.log(`[PO] Trying host: ${host}`);
  
  // ✅ NEW: Pre-fetch Cloudflare + session cookies from the target host
  const { cookies: hostCookies } = await preFetchCookies(host);
  if (hostCookies.length > 0) {
    this.prefetchedCookies = [...new Set([...this.prefetchedCookies, ...hostCookies])];
  }
  
  // Then try direct WebSocket or upgrade
  try { await this.connectDirect(host); return; } catch { ... }
  try { await this.connectWithUpgrade(host); return; } catch { ... }
}
```

---

### ✅ **ISSUE 4: Compression Breaking Cloudflare Connection (HIGH)**
**File:** `src/lib/pocketoption/client.ts:405, 475`
**Problem:**
- Both `connectDirect()` and `connectWithUpgrade()` had `perMessageDeflate: true`
- Cloudflare has issues with WebSocket compression in certain configurations
- Can cause "Disconnected before READY" or premature close

**Fix Applied:**
```typescript
// BEFORE
const ws = new WebSocket(wsUrl, {
  headers: wsHeaders,
  handshakeTimeout: 30000,
  perMessageDeflate: true,  // ❌ Can break Cloudflare
  followRedirects: true,
});

// AFTER
const ws = new WebSocket(wsUrl, {
  headers: wsHeaders,
  handshakeTimeout: 30000,
  perMessageDeflate: false,  // ✅ Cloudflare compatible
  followRedirects: true,
});
```

---

## 🔍 Root Cause Analysis

### Why "Disconnected before READY"?

```
1. connectWithUpgrade() calls httpPollingOpen()
   └→ HTTP GET /socket.io/?transport=polling
   └→ Server responds with 200 OK + SID + Cloudflare cookies
   
2. ❌ BEFORE: WebSocket URL had NO SID
   wsUrl = "wss://api-eu.po.market/socket.io/?EIO=4&transport=websocket"
   └→ Server sees NEW CONNECTION (no session context)
   └→ "AUTHENTICATING" state entered
   └→ No valid session → Auth fails → Server closes socket
   └→ Result: "Disconnected before READY"

3. ✅ AFTER: WebSocket URL has SID
   wsUrl = "wss://api-eu.po.market/socket.io/?EIO=4&transport=websocket&sid=abc123"
   └→ Server recognizes EXISTING session
   └→ Applies Cloudflare cookies from polling phase
   └→ Auth succeeds → State: READY
   └→ Candles flow normally
```

---

## 🧪 Testing the Fix

Run the diagnostic test:
```bash
# With a valid demo SSID
npx ts-node test-po-connection.ts "YOUR_SSID"

# This will:
# 1. Discover reachable hosts
# 2. Pre-fetch Cloudflare cookies per host
# 3. Connect via WebSocket (direct or upgrade)
# 4. Authenticate
# 5. Request candle history
# 6. Listen for live candles (10s)
# 7. Report connection stats
```

---

## 📊 Expected Behavior After Fix

### Before (Failed):
```
[PO] Direct WebSocket failed on try-demo-eu.po.market: Disconnected before READY
[PO] handleDisconnect called. State was: AUTHENTICATING
[PO] Upgrade failed on try-demo-eu.po.market: Disconnected before READY
[PO] Scheduling reconnect in 3s (attempt 1, failures: 1)...
[Infinite reconnect loop]
```

### After (Should Work):
```
[PO] Trying host: try-demo-eu.po.market
[PO-Cookie] Got 3 Cloudflare/session cookies from try-demo-eu.po.market
[PO] Direct WebSocket succeeded
[PO] Upgrade timeout (30s) - skipped, direct worked
[PO] handleSocketIOEvent: successauth
[PO] state = READY
[PO] Listening for live candles...
✅ Ready to receive candle data
```

---

## 🔐 Security Notes

- ✅ No hardcoded secrets
- ✅ Cookies are session-bound (server-generated)
- ✅ SID is URL-encoded properly
- ✅ Cloudflare protection properly respected
- ✅ No certificate validation bypass

---

## 📌 Summary of Files Modified

1. **`src/lib/pocketoption/connection.ts`**
   - Fixed `preFetchCookies()` to fetch from specific host instead of main domain
   - Updated timeout from 5s to 10s for reliability
   - Added logging for cookie origin

2. **`src/lib/pocketoption/client.ts`**
   - Added cookie pre-fetch call in `connect()` method
   - Disabled `perMessageDeflate` in both `connectDirect()` and `connectWithUpgrade()`
   - Ensured SID is included in WebSocket upgrade URL (from prior commit)

3. **`test-po-connection.ts`** (new)
   - Diagnostic tool to test connection end-to-end
   - Monitors auth, balances, candles
   - Reports connection statistics

---

## ✨ Next Steps

1. Test with a valid SSID
2. Verify candle data flows correctly
3. Monitor for any timeout issues
4. Check logs for "READY" state confirmation
5. Verify reconnection logic works if host becomes unavailable
