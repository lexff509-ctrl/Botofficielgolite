// background.js — BotOfficiel Bridge v1.3 (MV3 Stable)
// Fix: Service Worker MV3 goes to sleep after 30s → persist all state to chrome.storage.local
// Fix: Restore state from storage on SW startup → keepalive works even after sleep

const API_URL = "https://botofficielgolite-production.up.railway.app/api/extension/sync";

// In-memory state (will be restored from storage on SW restart)
let lastSyncedSsid = "";
let isSyncing = false;
let lastUid = 0;
let latestBalance = { demo: 0, live: 0 };
let username = "";
let isDemoMode = true;
let isConnected = false;

// ─── Badge helper ───────────────────────────────────────────────────────────
function setBadge(connected) {
  chrome.action.setBadgeText({ text: connected ? "ON" : "OFF" });
  chrome.action.setBadgeBackgroundColor({ color: connected ? "#22c55e" : "#ef4444" });
}

// ─── RESTORE STATE from storage on SW startup (critical for MV3) ───────────
async function restoreState() {
  const stored = await chrome.storage.local.get([
    "lastSyncedSsid", "lastUid", "latestBalance",
    "username", "isDemoMode", "isConnected"
  ]);
  if (stored.lastSyncedSsid) lastSyncedSsid = stored.lastSyncedSsid;
  if (stored.lastUid)        lastUid        = stored.lastUid;
  if (stored.latestBalance)  latestBalance  = stored.latestBalance;
  if (stored.username)       username       = stored.username;
  if (stored.isDemoMode !== undefined) isDemoMode = stored.isDemoMode;
  isConnected = !!stored.isConnected;
  setBadge(isConnected);
  console.log("[BRIDGE] State restored from storage. SSID present:", !!lastSyncedSsid);
}
restoreState();

// ─── PERSIST STATE to storage on every update ──────────────────────────────
async function persistState() {
  await chrome.storage.local.set({
    lastSyncedSsid,
    lastUid,
    latestBalance,
    username,
    isDemoMode,
    isConnected,
  });
}

// ─── Listen for data from content script ───────────────────────────────────
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "PO_BRIDGE_DATA") {
    const payload = message.payload;
    if (payload.type === "AUTH") {
      isDemoMode = payload.isDemo !== false;
      const { ssid, uid } = payload;
      if (uid) lastUid = uid;
      if (ssid && ssid !== lastSyncedSsid) {
        console.log("[BRIDGE] New session detected, syncing...");
        syncToServer({ ssid, uid: lastUid, isDemo: isDemoMode, balanceData: latestBalance, username });
      }
    } else if (payload.type === "INCOMING_WS") {
      const data = payload.data;
      try {
        const jsonStr = data.replace(/^[0-9-]+/, "");
        if (jsonStr.startsWith("[")) {
          const arr = JSON.parse(jsonStr);
          let shouldSync = false;
          if (arr[0] === "updateBalances" && arr[1]) {
            if (arr[1].demo !== undefined) latestBalance.demo = arr[1].demo;
            if (arr[1].live !== undefined) latestBalance.live = arr[1].live;
            shouldSync = true;
          } else if (arr[0] === "updateProfile" && arr[1]) {
            if (arr[1].nickname || arr[1].name) {
              username = arr[1].nickname || arr[1].name;
              shouldSync = true;
            }
          }
          if (shouldSync && lastSyncedSsid) {
            syncToServer({ ssid: lastSyncedSsid, uid: lastUid, isDemo: isDemoMode, balanceData: latestBalance, username });
          }
        }
      } catch (e) {}
    } else if (payload.type === "KEEPALIVE_PING") {
      // Content script pings us every 25s to prevent SW from sleeping
      // Just respond to confirm SW is alive
      console.log("[BRIDGE] SW keepalive ping received from content script");
    }
  }
});

// ─── ALARMS — wake SW every 25 seconds via alarms ──────────────────────────
// chrome.alarms minimum is 1 minute in MV3, but we use it as backup
chrome.alarms.create("keepAlive", { periodInMinutes: 1 });
chrome.alarms.create("heartbeat", { periodInMinutes: 0.5 }); // ~30s backup

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === "keepAlive" || alarm.name === "heartbeat") {
    // Always restore state in case SW woke from sleep
    await restoreState();
    if (lastSyncedSsid) {
      console.log(`[BRIDGE] ${alarm.name} — syncing heartbeat...`);
      syncToServer({
        ssid: lastSyncedSsid,
        uid: lastUid,
        isDemo: isDemoMode,
        balanceData: latestBalance,
        username
      });
    } else {
      console.log(`[BRIDGE] ${alarm.name} — no SSID yet, skipping.`);
    }
  }
});

// ─── SYNC to server ─────────────────────────────────────────────────────────
async function syncToServer(data) {
  if (isSyncing) return;
  const { apiKey } = await chrome.storage.local.get(["apiKey"]);
  if (!apiKey) {
    console.warn("[BRIDGE] No API Key found, sync aborted");
    await chrome.storage.local.set({ lastSyncStatus: "no_api_key", isConnected: false });
    return;
  }
  isSyncing = true;
  try {
    // ✅ CAPTURE COOKIES (New in v1.3.1)
    let cookieString = "";
    try {
      const allCookiesFromBrowser = await chrome.cookies.getAll({});
      const poDomains = ["pocketoption.com", "po.market"];
      const poCookies = allCookiesFromBrowser.filter(c => 
        poDomains.some(domain => c.domain.includes(domain))
      );
      const uniqueCookies = Array.from(new Map(poCookies.map(c => [c.name, c])).values());
      cookieString = uniqueCookies.map(c => `${c.name}=${c.value}`).join("; ");
      console.log(`[BRIDGE] Captured ${uniqueCookies.length} cookies (${cookieString.length} bytes)`);
    } catch (cookieErr) {
      console.error("[BRIDGE] Failed to capture cookies:", cookieErr.message);
    }

    const payload = {
      apiKey,
      ssid: data.ssid,
      cookies: cookieString, // ✅ ADDED cookies field
      uid: data.uid,
      isDemo: data.isDemo,
      demoBalance: data.balanceData?.demo,
      liveBalance: data.balanceData?.live,
      username: data.username,
      deviceName: "Chrome Bridge v1.3.1 (Stable)",
    };
    const res = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      if (data.ssid) lastSyncedSsid = data.ssid;
      isConnected = true;
      setBadge(true);
      await chrome.storage.local.set({
        lastSyncStatus: "success",
        lastSyncTime: new Date().toISOString(),
        lastUid: data.uid,
        isConnected: true,
        lastUsername: data.username || "",
        lastMode: data.isDemo ? "DEMO" : "LIVE",
      });
      await persistState(); // Persist all critical state for next SW wakeup
      console.log("[BRIDGE] ✅ Sync OK — isConnected = true");
    } else {
      const err = await res.json().catch(() => ({ error: "Unknown error" }));
      isConnected = false;
      setBadge(false);
      await chrome.storage.local.set({ lastSyncStatus: "error", lastSyncError: err.error, isConnected: false });
      await persistState();
      console.error("[BRIDGE] ❌ Sync fail:", err.error, "→", err.hint || "(no detail)");
    }
  } catch (e) {
    isConnected = false;
    setBadge(false);
    await chrome.storage.local.set({ lastSyncStatus: "error", lastSyncError: e.message, isConnected: false });
    await persistState();
    console.error("[BRIDGE] ❌ Network error:", e.message);
  } finally {
    isSyncing = false;
  }
}
