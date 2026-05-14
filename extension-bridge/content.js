// content.js — Runs in ISOLATED world (default, has chrome.* APIs)
// Listens to window.postMessage from content-interceptor.js (MAIN world)
// Relays messages to background.js via chrome.runtime.sendMessage

window.addEventListener("message", function (event) {
  if (event.source !== window) return;
  if (!event.data || event.data.type !== "PO_BRIDGE_DATA") return;

  // Relay to background service worker
  try {
    chrome.runtime.sendMessage(event.data);
  } catch (e) {
    // Extension context might be invalidated on reload, ignore
  }
});
