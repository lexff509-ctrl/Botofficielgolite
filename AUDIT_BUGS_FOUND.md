# 🔍 AUDIT PRODUCTION-GRADE: BUGS RÉELS IDENTIFIÉS

## BUGS CRITIQUES (SÉVÉRITÉ: HAUTE)

### BUG #1: Memory Leak - zombieCheckInterval jamais démarré
**Fichier:** `src/lib/pocketoption/client.ts`
**Ligne:** 258-290 (startHeartbeats)

**Problème:**
```typescript
// ❌ LIGNE 258-290: zombieCheckInterval est mentionné dans le cleanup (ligne 1205)
// mais JAMAIS initialisé/démarré dans startHeartbeats()
private socketIoHeartbeat: ReturnType<typeof setInterval> | null = null;
private zombieCheckInterval: ReturnType<typeof setInterval> | null = null; // ← jamais utilisé!

private startHeartbeats(): void {
  if (this.socketIoHeartbeat) clearInterval(this.socketIoHeartbeat); // ← oui
  // ... code heartbeat ...
  this.socketIoHeartbeat = setInterval(() => { ... }, this.pingInterval); // ← init ok
  // ❌ Mais zombieCheckInterval n'est jamais initialisé!
}
```

**Impact:** Zombie socket detection ne fonctionne pas. Les sockets mortes restent READY indéfiniment.

**Severité:** HAUTE (état invalide, memory leak)

---

### BUG #2: Race Condition - ensureConnected() non-atomic
**Fichier:** `src/services/network/PocketOptionConnectionManager.ts`
**Ligne:** 112-192

**Problème:**
```typescript
export async function ensureConnected(userId, ssid, isDemo) {
  const existing = sessions.get(userId);
  
  // ⚠️ FENÊTRE DE COURSE (0-5ms):
  // Entre 164 et 165, un autre appel peut passer le check
  
  if (!sessions.has(userId)) sessions.set(userId, session); // ligne 164
  session.state = "CONNECTING"; // ligne 165
  session.ssid = ssid;
  session.isDemo = isDemo;
  
  // ← Deux threads peuvent créer TWO PocketOptionClient instances!
  _registerClientHooks(session);
  await humanDelay(300, 800);
  
  try {
    await session.client.connect(isDemo); // ← deux connexions simultanées!
```

**Impact:** Avec 2+ appels rapides → 2 WebSocket connections pour 1 user → memory leak, duplicated events.

**Severité:** HAUTE (race condition dans state machine)

---

### BUG #3: Event Listener Memory Leak - candleListeners
**Fichier:** `src/lib/pocketoption/client.ts`
**Ligne:** 1376-1388

**Problème:**
```typescript
onCandle(asset: string, callback, size = 60): () => void {
  if (!this.candleListeners.has(asset)) this.candleListeners.set(asset, []);
  this.candleListeners.get(asset)!.push(callback);
  
  // ❌ Si client est recreé (reconnect), les anciens listeners restent!
  // La Map n'est jamais vidée lors de disconnect/cleanup
  
  return () => { /* unsubscribe code */ };
}

private cleanup(): void {
  // ❌ JAMAIS cleanéed:
  // this.candleListeners.clear(); // ← MISSING!
  // this.onAuthCallbacks = [];    // ← MISSING!
  // this.onBalanceCallbacks = []; // ← MISSING!
  // ...
}
```

**Impact:** 
- 1 reconnect = +N event listeners
- 10 reconnects = 10 × N listeners = memory bloat, slowdown
- Callbacks fired múltiple times for same event

**Severité:** HAUTE (exponential memory leak)

---

### BUG #4: Silent Exception Handling - catch {} blocks
**Fichier:** `src/lib/pocketoption/client.ts`
**Ligne:** 1268, 1277, 1369 (multiple locations)

**Problème:**
```typescript
try {
  const historyNew = await this.waitForEvent<any>("historyNew", 3000);
  const candles = this.parseCandleData(asset, historyNew);
  if (candles.length >= count) return candles;
} catch (e) {} // ❌ SILENTLY SWALLOWS ERROR!

try {
  const history = await this.waitForEvent<any>("history", 6000);
  const candles = this.parseCandleData(asset, history);
  if (candles.length > 0) return candles;
} catch (e) {} // ❌ NO LOGGING = IMPOSSIBLE TO DEBUG

return []; // ← Returns empty array, caller has NO IDEA what happened
```

**Impact:** 
- Network error? Unknown
- Timeout? Unknown
- WebSocket dead? Unknown
- Logs show nothing
- App behavior silent failures

**Severité:** HAUTE (impossible to debug production issues)

---

### BUG #5: activeSubscriptions Never Cleaned
**Fichier:** `src/lib/pocketoption/client.ts`
**Line:** 1223-1227

**Problème:**
```typescript
changeSymbol(asset: string, period: number): void {
  const poAsset = PocketOptionClient.toPOSymbol(asset);
  this.currentSymbol = { asset, period };
  this.activeSubscriptions.set(`${asset}:${period}`, { asset, size: period }); // ← Added
  // ❌ But cleanup() never clears this!
}

private cleanup(): void {
  // ❌ MISSING:
  // this.activeSubscriptions.clear();
  // ...
  this.internalEvents.removeAllListeners(); // ← OK
}
```

**Impact:** Reconnect cycles accumulate subscriptions → redundant network traffic

**Severité:** MOYENNE (performance degradation)

---

### BUG #6: OnCandle Callbacks Not Cleaned
**Fichier:** `src/lib/pocketoption/client.ts`
**Ligne:** 1390-1408

**Problème:**
```typescript
onAuth(callback): () => void {
  this.onAuthCallbacks.push(callback); // ← Added to array
  
  return () => { 
    this.onAuthCallbacks = this.onAuthCallbacks.filter((cb) => cb !== callback); 
  }; // ← Unsubscribe function returned
}

// ❌ But if client recreated without unsubscribe called:
// Old callbacks remain in onAuthCallbacks array!

// ❌ And cleanup() doesn't reset:
private cleanup(): void {
  // MISSING:
  // this.onAuthCallbacks = [];
  // this.onBalanceCallbacks = [];
  // this.onErrorCallbacks = [];
  // this.onSsidExpiredCallbacks = [];
}
```

**Impact:** 
- Old callbacks fire multiple times
- Handlers run with stale context
- Memory accumulates

**Severité:** HAUTE (listener leak + duplicate callbacks)

---

### BUG #7: pendingTicks Not Capped (Map growth unbounded)
**Fichier:** `src/lib/pocketoption/client.ts`
**Ligne:** 978-1012

**Problème:**
```typescript
private pendingTicks = new Map<string, CandleData>(); // ← unbounded

private startTickThrottler() {
  this.tickFlushInterval = setInterval(() => {
    for (const [asset, candle] of this.pendingTicks.entries()) {
      // ...
    }
    this.pendingTicks.clear(); // ← Clears every 100ms, OK
  }, 100);
}

private processStreamTick(message: any[]): void {
  // ... for each tick:
  this.pendingTicks.set(asset, { ... }); // ← Added
  // ✅ Cleared on flush, but if tickFlushInterval missed a cycle:
  // Ticks could accumulate briefly (100-200ms)
  // Minor issue but pattern is risky
}
```

**Impact:** Minor - pendingTicks brief accumulation if interval delays. But pattern is risky.

**Severité:** MÉDIA (temporary memory spike on lag)

---

## BUGS MODÉRÉS (SÉVÉRITÉ: MOYENNE)

### BUG #8: Reconnect Loop Risk - No Maximum Reconnects Limit
**Fichier:** `src/lib/pocketoption/client.ts`
**Ligne:** 1133-1188

**Problème:**
```typescript
// ✓ Circuit breaker exists (MAX_HARD_FAILURES = 12)
if (this.consecutiveFailures >= MAX_HARD_FAILURES) {
  // → enters circuit-open, waits for Bridge
  this.ssidExpired = true;
}

// ✓ But what about changing SSIDs rapidly?
// ensureConnected → refreshSession → disconnect old → try new
// If new SSID also bad → triggers new reconnect cycle

// ✓ ConnectionManager HAS cooldown (60s) but PocketOptionClient may not respect it
```

**Impact:** Rapid SSID changes could trigger multiple reconnect storms

**Severité:** MÉDIA (edge case, but risky during auth failures)

---

### BUG #9: Missing Error Logging in ConnectionManager
**Fichier:** `src/services/network/PocketOptionConnectionManager.ts`
**Ligne:** 196-212

**Problème:**
```typescript
// _registerClientHooks registers error handler:
session.client.onError((err) => {
  if (session.state === "READY") {
    console.warn(`[ConnMgr] Client error for user ${session.userId}: ${err.message}`);
    session.state = "RECONNECTING";
    _scheduleReconnect(session);
  }
  // ❌ But what if state is NOT READY?
  // Error silently ignored!
});

// Also:
session.client.onSsidExpired(() => {
  // ✓ OK, sets BLOCKED state
});
```

**Impact:** Errors during CONNECTING state are silently lost

**Severité:** MÉDIA (debugging difficulty)

---

## BUGS MINEURS (SÉVÉRITÉ: BASSE)

### BUG #10: Zombie Detection Logic Never Called
**Fichier:** `src/lib/pocketoption/client.ts`
**Ligne:** 258-290

**Déjà couvret par BUG #1**

---

### BUG #11: AsyncMutex Can Timeout Without Cleanup
**Fichier:** `src/lib/pocketoption/client.ts`
**Ligne:** 61-83

**Problème:**
```typescript
class AsyncMutex {
  async acquire(timeoutMs: number = 45000): Promise<() => void> {
    // ...
    const timeoutId = setTimeout(() => {
      console.warn(`[Mutex] Auto-released after ${timeoutMs}ms to prevent deadlock!`);
      release(); // ← Forces unlock
    }, timeoutMs);
    
    return () => {
      clearTimeout(timeoutId);
      release();
    };
  }
}

// If timeout fires: release() called, BUT
// Calling code might still think it holds the lock
// placeTrade() finally block always calls releaseMutex()
// So it's safe, but pattern is risky
```

**Impact:** Minimal with current code, but mutex auto-timeout is dangerous pattern

**Severité:** BASSA (but antipattern)

---

## RÉSUMÉ DES BUGS PAR SÉVÉRITÉ

| Sévérité | Count | Bugs |
|----------|-------|------|
| CRITIQUE | 6 | #1, #2, #3, #4, #5, #6 |
| MOYENNE | 3 | #8, #9, #11 |
| BASSA | 2 | #7, #10 |

---

## IMPACT COMBINÉ

Si non fixé:
- 🔴 Memory grows unbounded (reconnects × listeners)
- 🔴 Race conditions create duplicate connections
- 🔴 Silent failures make debugging impossible
- 🔴 Zombie sockets persist indefinitely
- 🔴 Production logs show NOTHING when things break

---

## ORDRE DE PRIORITÉ POUR FIXES

1. **BUG #3 (Listener Leak)** — Fix first, biggest memory impact
2. **BUG #1 (Zombie Check)** — Essential for stability
3. **BUG #2 (Race Condition)** — Prevents duplicate connections
4. **BUG #4 (Silent Errors)** — Critical for debugging
5. **BUG #6 (Callback Cleanup)** — Prevents duplicate events
6. **BUG #5 (Subscriptions)** — Performance optimization
7. Others as needed

