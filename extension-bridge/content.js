// content.js — BotOfficiel Bridge v1.2
// Runs in ISOLATED world (has chrome.* APIs)
// Relays messages from content-interceptor.js (MAIN world) to background.js
// 
// FIX MV3: Service Worker goes to sleep after ~30s inactivity.
// Solution: ping the SW every 25s to keep it alive.

// ─── Relay PocketOption data to background SW ──────────────────────────────
window.addEventListener("message", function (event) {
  if (event.source !== window) return;
  if (!event.data || event.data.type !== "PO_BRIDGE_DATA") return;

  try {
    chrome.runtime.sendMessage(event.data);
  } catch (e) {
    // Extension context invalidated on reload — ignore
  }
});

// ─── SW Keepalive — ping every 25s to prevent service worker from sleeping ─
function keepSwAlive() {
  try {
    chrome.runtime.sendMessage({
      type: "PO_BRIDGE_DATA",
      payload: { type: "KEEPALIVE_PING" }
    }, () => {
      // Ignore chrome.runtime.lastError — SW might be restarting
      void chrome.runtime.lastError;
    });
  } catch (e) {
    // Context might be invalidated — ignore
  }
}

// Start keepalive immediately then every 25 seconds
keepSwAlive();
setInterval(keepSwAlive, 25_000);
