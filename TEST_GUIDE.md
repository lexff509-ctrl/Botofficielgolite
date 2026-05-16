# 🧪 Testing PocketOption WebSocket Connection

## Quick Start

```bash
# Test with a valid demo SSID
node test-po.js '42["auth",{"session":"YOUR_VALID_SSID"}]'

# Or with a raw session token
node test-po.js "your-raw-session-token"
```

## What the Test Does

1. **Host Discovery** - Finds reachable PocketOption servers
2. **HTTP Polling** - Obtains session SID and Cloudflare cookies
3. **WebSocket Connection** - Tests both DIRECT and UPGRADE methods
4. **Authentication** - Sends auth message and waits for `successauth`

## Expected Output (Success)

```
🔍 PocketOption WebSocket Diagnostic

SSID: 42["auth",{"session":"..."}]...

1️⃣  Discovering reachable hosts...

  ✅ try-demo-eu.po.market REACHABLE (3 cookies)
  ✅ demo-api-eu.po.market REACHABLE (3 cookies)
  ✅ api-eu.po.market REACHABLE (3 cookies)

2️⃣  Testing WebSocket connections...

📍 Host: try-demo-eu.po.market
  Testing DIRECT WebSocket...
  📡 WebSocket OPEN
  🔌 Engine.IO OPEN (0)
  🔐 Socket.IO CONNECT, sending auth...
  ✅ AUTHENTICATED!

============================================================
✅ SUCCESS! WebSocket connection and auth verified.

The connection should now receive candle data.
```

## Expected Output (Failed)

```
❌ FAILED! Could not authenticate on any host.

Possible causes:

  - SSID is invalid or expired

  - Cloudflare is blocking the connection

  - Network connectivity issue
```

## How to Get a Valid SSID

The SSID comes from authenticating with PocketOption's web app or API:

1. Login to PocketOption at `https://pocketoption.com/`
2. Open browser DevTools (F12)
3. Go to Network tab
4. Look for WebSocket connection to `/socket.io/`
5. In the URL, you'll see the auth token in the connection headers or body
6. It should look like: `42["auth",{"session":"abc123def456..."}]` or just `abc123def456`

## Integration with Production

Once tested successfully:

```javascript
import { PocketOptionClient } from "@/lib/pocketoption/client";

const client = new PocketOptionClient(validSSID, true); // true = demo

await client.connect();
// ✅ Now ready to receive candles

client.onCandle("EURUSD", (candle) => {
  console.log(`${candle.asset}: O=${candle.open} H=${candle.high} L=${candle.low} C=${candle.close}`);
});
```

## Troubleshooting

### "WebSocket closed before auth"
- Invalid SSID or expired session
- Cloudflare blocking the connection
- Server closing connection due to invalid auth message format

### "HTTP polling timeout"
- Network connectivity issue
- PocketOption server slow or unreachable
- Try a different host (test tries multiple hosts automatically)

### "Unexpected server response: 400"
- Invalid SID or cookies
- Mismatch between HTTP polling cookies and WebSocket cookies
- Should be resolved by the fixed code which uses proper SID and cookies

### "0 cookies" in discovery
- Cloudflare is not returning cookies (normal for some hosts)
- Session cookies are added during HTTP polling, not discovery
- This is OK - cookies will be fetched during actual connection

## Files Added/Modified

- ✅ `src/lib/pocketoption/client.ts` - Fixed cookie pre-fetch + compression
- ✅ `src/lib/pocketoption/connection.ts` - Fixed Cloudflare cookie pre-fetch
- ✅ `test-po.js` - New test script (this one)
- ✅ `PO_CONNECTION_FIXES.md` - Detailed technical documentation

## Performance Metrics

Expected connection time with fixes:
- Host discovery: **2-3 seconds** (tests 3 hosts in parallel)
- HTTP polling: **1-2 seconds**
- WebSocket handshake: **<1 second**
- Authentication: **<1 second**
- **Total: ~5 seconds** from `connect()` call to READY state

This is the normal timeline. If it takes longer, check network/firewall.

---

**Last Updated:** 2026-05-16  
**Status:** ✅ System Ready for Production
