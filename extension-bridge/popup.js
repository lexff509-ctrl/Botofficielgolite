// popup.js — BotOfficiel Bridge v1.1

const STORAGE_KEYS = ["isConnected", "lastSyncStatus", "lastSyncTime", "lastSyncError", "lastUsername", "lastMode", "apiKey"];

function formatTime(isoStr) {
  if (!isoStr) return "—";
  try {
    return new Date(isoStr).toLocaleTimeString("fr-FR");
  } catch { return "—"; }
}

function refreshStatus() {
  chrome.storage.local.get(STORAGE_KEYS, (data) => renderStatus(data));
}

function renderStatus(data) {
  const badge = document.getElementById("statusBadge");
  const dot = document.getElementById("statusDot");
  const text = document.getElementById("statusText");
  const infoRows = document.getElementById("infoRows");
  if (!badge) return;

  const connected = data.isConnected === true;
  const hasKey = !!data.apiKey;
  const status = data.lastSyncStatus;

  // Status badge
  if (connected && status === "success") {
    badge.className = "status-badge connected";
    dot.className = "dot green";
    text.textContent = "🟢 Bridge Connecté";
  } else if (!hasKey || status === "no_api_key") {
    badge.className = "status-badge waiting";
    dot.className = "dot yellow";
    text.textContent = "⚙️ Clé API requise";
  } else if (status === "error") {
    badge.className = "status-badge disconnected";
    dot.className = "dot red";
    text.textContent = "🔴 Erreur de sync";
  } else if (hasKey) {
    badge.className = "status-badge waiting";
    dot.className = "dot yellow";
    text.textContent = "⏳ Ouvrez PocketOption...";
  } else {
    badge.className = "status-badge waiting";
    dot.className = "dot yellow";
    text.textContent = "⏳ En attente...";
  }

  // Info rows
  const rows = [
    { label: "Dernier sync", value: formatTime(data.lastSyncTime), cls: connected ? "green" : "" },
    { label: "Mode", value: data.lastMode || "—", cls: data.lastMode === "LIVE" ? "green" : "yellow" },
    { label: "Utilisateur PO", value: data.lastUsername || "—", cls: "" },
    { label: "Statut", value: status === "success" ? "OK ✓" : (status || "—"), cls: status === "success" ? "green" : status === "error" ? "red" : "yellow" },
  ];

  infoRows.innerHTML = rows.map(r => `
    <div class="info-row">
      <span class="info-label">${r.label}</span>
      <span class="info-value ${r.cls}">${r.value}</span>
    </div>
  `).join("");

  // Pre-fill API key field only if empty
  const input = document.getElementById("apiKeyInput");
  if (data.apiKey && !input.value) {
    input.value = data.apiKey;
  }
}

// Initial load
refreshStatus();

// Auto-refresh every 2 seconds while popup is open
setInterval(refreshStatus, 2000);

// Bind save button directly — script loads at bottom of body so DOM is already ready
// NO DOMContentLoaded needed. NO inline onclick (forbidden by Chrome MV3 CSP).
document.getElementById("saveBtn").addEventListener("click", function () {
  const key = document.getElementById("apiKeyInput").value.trim();
  if (!key) {
    document.getElementById("statusText").textContent = "⚠️ Collez votre clé d'abord";
    return;
  }
  chrome.storage.local.set(
    { apiKey: key, lastSyncStatus: "pending", isConnected: false },
    function () {
      const msg = document.getElementById("saveMsg");
      msg.style.display = "block";
      setTimeout(function () { msg.style.display = "none"; }, 2500);
      refreshStatus();
    }
  );
});

document.getElementById("refreshPoBtn").addEventListener("click", function () {
  chrome.tabs.query({ url: "*://*.pocketoption.com/*" }, function(tabs) {
    if (tabs.length > 0) {
      chrome.tabs.reload(tabs[0].id);
      document.getElementById("statusText").textContent = "🔄 PO Rafraîchi !";
      const dot = document.getElementById("statusDot");
      if(dot) dot.className = "dot yellow";
    } else {
      // S'il n'y a pas d'onglet ouvert, en ouvrir un nouveau
      chrome.tabs.create({ url: "https://pocketoption.com/fr/cabinet/demo-quick-high-low/" });
    }
  });
});
