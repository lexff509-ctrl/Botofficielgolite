// background.js
const API_URL = "https://botofficielgolite.onrender.com/api/extension/sync";
let lastSyncedSsid = "";
let isSyncing = false;
let lastUid = 0;
let latestBalance = { demo: 0, live: 0 };
let username = "";
let isDemoMode = true;
// Listen for data from content script
chrome.runtime.onMessage.addListener((message) => {
    if (message.type === "PO_BRIDGE_DATA") {
        const payload = message.payload;
        if (payload.type === "AUTH") {
            isDemoMode = payload.isDemo !== false;
            const { ssid, uid } = payload;
            lastUid = uid || lastUid;
            if (ssid && ssid !== lastSyncedSsid) {
                console.log("[Bridge] New session detected, syncing...");
                syncToServer({ ssid, uid: lastUid, isDemo: isDemoMode, balanceData: latestBalance, username });
            }
        }
        else if (payload.type === "INCOMING_WS") {
            const data = payload.data;
            try {
                const jsonStr = data.replace(/^[0-9-]+/, '');
                if (jsonStr.startsWith('[')) {
                    const arr = JSON.parse(jsonStr);
                    let shouldSync = false;
                    if (arr[0] === 'updateBalances' && arr[1]) {
                        if (arr[1].demo !== undefined)
                            latestBalance.demo = arr[1].demo;
                        if (arr[1].live !== undefined)
                            latestBalance.live = arr[1].live;
                        shouldSync = true;
                    }
                    else if (arr[0] === 'updateProfile' && arr[1]) {
                        if (arr[1].nickname || arr[1].name) {
                            username = arr[1].nickname || arr[1].name;
                            shouldSync = true;
                        }
                    }
                    if (shouldSync && lastSyncedSsid) {
                        // Only sync balance/profile if we already have a session
                        syncToServer({ ssid: lastSyncedSsid, uid: lastUid, isDemo: isDemoMode, balanceData: latestBalance, username });
                    }
                }
            }
            catch (e) { }
        }
    }
});
// Periodic check (every 1 minute) to ensure connection is alive
chrome.alarms.create("keepAlive", { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === "keepAlive" && lastSyncedSsid) {
        syncToServer({ ssid: lastSyncedSsid, uid: lastUid, isDemo: isDemoMode, balanceData: latestBalance, username });
    }
});
async function syncToServer(data) {
    if (isSyncing)
        return;
    const { apiKey } = await chrome.storage.local.get(["apiKey"]);
    if (!apiKey) {
        console.warn("[Bridge] No API Key found, sync aborted");
        return;
    }
    isSyncing = true;
    try {
        const payload = {
            apiKey,
            ssid: data.ssid,
            uid: data.uid,
            isDemo: data.isDemo,
            demoBalance: data.balanceData?.demo,
            liveBalance: data.balanceData?.live,
            username: data.username,
            deviceName: navigator.userAgent
        };
        const res = await fetch(API_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });
        if (res.ok) {
            if (data.ssid)
                lastSyncedSsid = data.ssid;
            await chrome.storage.local.set({
                lastSyncStatus: "success",
                lastSyncTime: new Date().toISOString(),
                lastUid: data.uid
            });
            console.log("[Bridge] Sync successful", payload);
        }
        else {
            const err = await res.json();
            await chrome.storage.local.set({ lastSyncStatus: "error", lastSyncError: err.error });
        }
    }
    catch (e) {
        await chrome.storage.local.set({ lastSyncStatus: "error", lastSyncError: e.message });
    }
    finally {
        isSyncing = false;
    }
}
