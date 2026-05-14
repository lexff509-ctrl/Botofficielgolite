// popup.js — BotOfficiel Bridge

function formatTime(isoStr) {
  if (!isoStr) return "—";
  try {
    return new Date(isoStr).toLocaleTimeString("fr-FR");
  } catch { return "—"; }
}

function renderStatus(data) {
  const badge = document.getElementById("statusBadge");
  const dot = document.getElementById("statusDot");
  const text = document.getElementById("statusText");
  const infoRows = document.getElementById("infoRows");

  const connected = data.isConnected === true;
  const hasKey = !!data.apiKey;
  const status = data.lastSyncStatus;

  // Status badge
  if (connected && status === "success") {
    badge.className = "status-badge connected";
    dot.className = "dot green";
    text.textContent = "🟢 Bridge Connecté";
  } else if (status === "no_api_key" || !hasKey) {
    badge.className = "status-badge waiting";
    dot.className = "dot yellow";
    text.textContent = "⚙️ Clé API requise";
  } else if (status === "error") {
    badge.className = "status-badge disconnected";
    dot.className = "dot red";
    text.textContent = "🔴 Erreur de sync";
  } else {
    badge.className = "status-badge waiting";
    dot.className = "dot yellow";
    text.textContent = "⏳ En attente de PocketOption...";
  }

  // Info rows
  const rows = [
    { label: "Dernier sync", value: formatTime(data.lastSyncTime), cls: connected ? "green" : "" },
    { label: "Mode", value: data.lastMode || "—", cls: data.lastMode === "LIVE" ? "green" : "yellow" },
    { label: "Utilisateur PO", value: data.lastUsername || "—", cls: "" },
    { label: "Statut API", value: status === "success" ? "OK" : (status || "—"), cls: status === "success" ? "green" : "red" },
  ];

  infoRows.innerHTML = rows.map(r => `
    <div class="info-row">
      <span class="info-label">${r.label}</span>
      <span class="info-value ${r.cls}">${r.value}</span>
    </div>
  `).join("");

  // Pre-fill API key if exists
  if (data.apiKey) {
    document.getElementById("apiKeyInput").value = data.apiKey;
  }
}

// Load current state
chrome.storage.local.get(
  ["isConnected", "lastSyncStatus", "lastSyncTime", "lastSyncError", "lastUsername", "lastMode", "apiKey"],
  (data) => renderStatus(data)
);

// Save API key
function saveKey() {
  const key = document.getElementById("apiKeyInput").value.trim();
  if (!key) return;
  chrome.storage.local.set({ apiKey: key }, () => {
    const msg = document.getElementById("saveMsg");
    msg.style.display = "block";
    setTimeout(() => { msg.style.display = "none"; }, 2000);
  });
}
