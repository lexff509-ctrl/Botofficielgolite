// content-interceptor.js — Runs in MAIN world (page JS context)
// Has access to window.WebSocket but NOT chrome.* APIs
// Communicates with content.js (ISOLATED world) via window.postMessage

(function () {
  if (window.__botOfficielBridgeActive) return;
  window.__botOfficielBridgeActive = true;

  const OriginalWebSocket = window.WebSocket;

  function BridgeWebSocket(url, protocols) {
    const ws = protocols
      ? new OriginalWebSocket(url, protocols)
      : new OriginalWebSocket(url);

    // Intercept INCOMING: balance/profile updates
    ws.addEventListener("message", function (event) {
      if (typeof event.data === "string") {
        if (
          event.data.includes("updateBalances") ||
          event.data.includes("updateProfile")
        ) {
          window.postMessage(
            { type: "PO_BRIDGE_DATA", payload: { type: "INCOMING_WS", data: event.data } },
            "*"
          );
        }
      }
    });

    // Intercept OUTGOING: auth/session capture
    const originalSend = ws.send.bind(ws);
    ws.send = function (data) {
      if (typeof data === "string" && data.includes('"session"')) {
        try {
          const jsonPart = data.startsWith("42") ? data.substring(2) : data;
          const parsed = JSON.parse(jsonPart);
          if (Array.isArray(parsed) && parsed[1] && parsed[1].session) {
            const auth = parsed[1];
            window.postMessage(
              {
                type: "PO_BRIDGE_DATA",
                payload: {
                  type: "AUTH",
                  ssid: data,
                  uid: auth.uid || 0,
                  isDemo: auth.isDemo !== 0 && auth.isDemo !== false,
                },
              },
              "*"
            );
          }
        } catch (e) {}
      }
      return originalSend(data);
    };

    return ws;
  }

  BridgeWebSocket.prototype = OriginalWebSocket.prototype;
  BridgeWebSocket.CONNECTING = OriginalWebSocket.CONNECTING;
  BridgeWebSocket.OPEN = OriginalWebSocket.OPEN;
  BridgeWebSocket.CLOSING = OriginalWebSocket.CLOSING;
  BridgeWebSocket.CLOSED = OriginalWebSocket.CLOSED;
  window.WebSocket = BridgeWebSocket;
})();
