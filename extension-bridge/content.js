// content.js
const injectionCode = `
(function() {
  const OriginalWebSocket = window.WebSocket;
  window.WebSocket = function(url, protocols) {
    const ws = new OriginalWebSocket(url, protocols);
    
    ws.addEventListener('message', function(event) {
      if (typeof event.data === 'string') {
        if (event.data.includes('updateBalances') || event.data.includes('balance') || event.data.includes('updateProfile')) {
           window.postMessage({ type: 'PO_BRIDGE_DATA', payload: { type: 'INCOMING_WS', data: event.data } }, '*');
        }
      }
    });

    const originalSend = ws.send;
    ws.send = function(data) {
      if (typeof data === 'string' && data.startsWith('42["auth"')) {
        try {
          const parsed = JSON.parse(data.substring(2));
          if (parsed && parsed.length > 1 && parsed[1].session) {
            window.postMessage({
              type: "PO_BRIDGE_DATA",
              payload: {
                type: "AUTH",
                ssid: data,
                uid: parsed[1].uid || 0,
                isDemo: parsed[1].isDemo
              }
            }, "*");
          }
        } catch (e) {}
      }
      return originalSend.apply(this, arguments);
    };
    
    return ws;
  };
  window.WebSocket.prototype = OriginalWebSocket.prototype;
})();
`;
const script = document.createElement("script");
script.textContent = injectionCode;
(document.head || document.documentElement).appendChild(script);
script.remove();
window.addEventListener("message", (event) => {
    if (event.source !== window)
        return;
    if (event.data && event.data.type === "PO_BRIDGE_DATA") {
        chrome.runtime.sendMessage(event.data);
    }
});
console.log("[BotOfficiel Bridge] Active on " + window.location.host);
