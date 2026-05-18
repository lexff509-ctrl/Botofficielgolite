/**
 * PocketOptionConnectionManager
 * 
 * Human-like connection manager with:
 * - State machine (IDLE → CONNECTING → READY → RECONNECTING → COOLDOWN → BLOCKED)
 * - Exponential backoff with jitter
 * - Host rotation with blacklist
 * - Session validation before every action
 * - Self-healing: auto-recovery on SSID expiry, timeout, dead session
 * - Zero crash: all errors caught, process never dies
 */

import { PocketOptionClient } from "@/lib/pocketoption/client";
import { invalidateHostCache } from "@/lib/pocketoption/connection";
import { SystemLogger } from "@/lib/system-logger";
import { updateSsidStatus } from "@/services/trading.service";
import { EventEmitter } from "events";

// Global event bus for connection state changes
export const connectionEvents = new EventEmitter();
connectionEvents.setMaxListeners(100);

// ── State Machine ──────────────────────────────────────────────────────────────
export type ConnectionState =
  | "IDLE"
  | "CONNECTING"
  | "READY"
  | "RECONNECTING"
  | "COOLDOWN"
  | "BLOCKED";

const VALID_TRANSITIONS: Record<ConnectionState, ConnectionState[]> = {
  "IDLE": ["CONNECTING", "RECONNECTING"],
  "CONNECTING": ["READY", "RECONNECTING", "BLOCKED", "IDLE"],
  "READY": ["RECONNECTING", "IDLE", "BLOCKED"],
  "RECONNECTING": ["READY", "COOLDOWN", "BLOCKED", "IDLE"],
  "COOLDOWN": ["IDLE", "CONNECTING"],
  "BLOCKED": ["IDLE"]
};

function transitionTo(session: ManagedSession, newState: ConnectionState) {
  const current = session.state;
  if (current === newState) return;
  
  if (!VALID_TRANSITIONS[current].includes(newState)) {
    console.warn(`[ConnMgr] Blocked invalid transition: ${current} -> ${newState}`);
    return;
  }
  
  session.state = newState;
  console.log(`[ConnMgr] User ${session.userId} transition: ${current} -> ${newState}`);
  connectionEvents.emit("state:change", { userId: session.userId, from: current, to: newState });
}

// ── Host Blacklist ─────────────────────────────────────────────────────────────
interface BlacklistedHost {
  host: string;
  until: number;
  reason: string;
}

const BLACKLIST_DURATION_MS = 15 * 60 * 1000; // 15 min
const hostBlacklist: Map<string, BlacklistedHost> = new Map();

export function blacklistHost(host: string, reason: string): void {
  hostBlacklist.set(host, { host, until: Date.now() + BLACKLIST_DURATION_MS, reason });
  console.warn(`[ConnMgr] Host blacklisted for 15min: ${host} — ${reason}`);
  SystemLogger.warn("ConnectionManager", `Host blacklisted: ${host}`, { reason });
}

export function isHostBlacklisted(host: string): boolean {
  const entry = hostBlacklist.get(host);
  if (!entry) return false;
  if (Date.now() > entry.until) {
    hostBlacklist.delete(host);
    return false;
  }
  return true;
}

export function getBlacklist(): BlacklistedHost[] {
  const now = Date.now();
  const active = Array.from(hostBlacklist.values()).filter(h => h.until > now);
  // Cleanup expired
  for (const [host, entry] of hostBlacklist) {
    if (entry.until <= now) hostBlacklist.delete(host);
  }
  return active;
}

// ── Connection Session ─────────────────────────────────────────────────────────
interface ManagedSession {
  userId: number;
  ssid: string;
  uid?: string;
  cookies?: string;
  isDemo: boolean;
  client: PocketOptionClient;
  state: ConnectionState;
  connectedAt: number | null;
  lastActivityAt: number;
  reconnectAttempts: number;
  cooldownUntil: number;
  ssidRefreshedAt: number;
}

// ── Global Session Registry ────────────────────────────────────────────────────
const sessions = new Map<number, ManagedSession>();

// ── Backoff Schedule ───────────────────────────────────────────────────────────
// 5s, 10s, 20s, 40s, 60s (capped) - strict exponential backoff
const BACKOFF_SCHEDULE = [5000, 10000, 20000, 40000, 60000];

function getBackoff(attempt: number): number {
  const base = BACKOFF_SCHEDULE[Math.min(attempt, BACKOFF_SCHEDULE.length - 1)];
  const jitter = base * (0.8 + Math.random() * 0.4);
  return Math.round(jitter);
}

// ── Human-Like Delay ───────────────────────────────────────────────────────────
function humanDelay(minMs = 500, maxMs = 1500): Promise<void> {
  return new Promise(r => setTimeout(r, minMs + Math.random() * (maxMs - minMs)));
}

// ── Core: Get or Create Session ────────────────────────────────────────────────
export function getSession(userId: number): ManagedSession | null {
  return sessions.get(userId) || null;
}

export function getSessionState(userId: number): ConnectionState {
  return sessions.get(userId)?.state || "IDLE";
}

/**
 * Connect or reconnect a user to PocketOption.
 * Fully idempotent — safe to call multiple times.
 */
export async function ensureConnected(
  userId: number,
  ssid: string,
  isDemo: boolean,
  cookies?: string,
  uid?: string
): Promise<PocketOptionClient | null> {
  const existing = sessions.get(userId);

  // Already READY with same SSID → return immediately (session reuse)
  if (existing && existing.state === "READY" && existing.client.isConnected && existing.ssid === ssid) {
    existing.lastActivityAt = Date.now();
    return existing.client;
  }

  // Blocked → wait for Bridge to provide new SSID
  if (existing && existing.state === "BLOCKED") {
    console.warn(`[ConnMgr] User ${userId} is BLOCKED — waiting for Bridge SSID refresh`);
    return null;
  }

  // Already connecting → don't double-connect
  if (existing && (existing.state === "CONNECTING" || existing.state === "RECONNECTING")) {
    console.log(`[ConnMgr] User ${userId} already ${existing.state} — skipping duplicate`);
    return null;
  }

  // In cooldown → reject until ready
  if (existing && existing.state === "COOLDOWN" && Date.now() < existing.cooldownUntil) {
    const remainSec = Math.round((existing.cooldownUntil - Date.now()) / 1000);
    console.log(`[ConnMgr] User ${userId} in COOLDOWN — ${remainSec}s remaining`);
    return null;
  }

  // New SSID → teardown old client first
  if (existing && existing.ssid !== ssid) {
    console.log(`[ConnMgr] New SSID detected for user ${userId} — tearing down old connection`);
    try { existing.client.disconnect(); } catch {}
  }

  // Init or update session
  const cookieArr = cookies ? cookies.split(";").map(c => c.trim()) : undefined;
  const parsedUid = uid ? parseInt(uid) : undefined;
  
  if (existing && existing.ssid === ssid) {
    // If SSID is the same but we got new cookies, update the client
    if (cookieArr && cookieArr.length > 0) {
      existing.cookies = cookies;
      existing.client.updateCookies(cookieArr);
    }
    if (parsedUid !== undefined) existing.uid = uid;
  }

  const session: ManagedSession = existing && existing.ssid === ssid ? existing : {
    userId,
    ssid,
    uid,
    cookies,
    isDemo,
    client: new PocketOptionClient(ssid, isDemo, cookieArr, parsedUid),
    state: "IDLE",
    connectedAt: null,
    lastActivityAt: Date.now(),
    reconnectAttempts: 0,
    cooldownUntil: 0,
    ssidRefreshedAt: Date.now(),
  };

  if (!sessions.has(userId)) sessions.set(userId, session);
  transitionTo(session, "CONNECTING");
  session.ssid = ssid;
  session.isDemo = isDemo;

  // Register self-healing callbacks
  _registerClientHooks(session);

  // Human-like delay before connect (anti-detection)
  await humanDelay(300, 800);

  try {
    await session.client.connect(isDemo);
    transitionTo(session, "READY");
    session.connectedAt = Date.now();
    session.reconnectAttempts = 0;
    session.lastActivityAt = Date.now();
    updateSsidStatus(userId, "VALID").catch(() => {}); // Update DB status on success
    SystemLogger.info("ConnectionManager", `User ${userId} connected (${isDemo ? "DEMO" : "LIVE"})`);
    console.log(`[ConnMgr] ✅ User ${userId} READY`);
    // Emit bridge:connected to trigger bot sync
    connectionEvents.emit("bridge:connected", { userId, isDemo, isReconnect: false });
    return session.client;
  } catch (err: any) {
    console.error(`[ConnMgr] Connection failed for user ${userId}:`, err.message);
    transitionTo(session, "RECONNECTING");
    _scheduleReconnect(session);
    return null;
  }
}

// ── Self-Healing Callbacks ─────────────────────────────────────────────────────
function _registerClientHooks(session: ManagedSession): void {
  // SSID expired → BLOCKED state (wait for Bridge)
  session.client.onSsidExpired(() => {
    if (session.state === "BLOCKED") return;
    console.warn(`[ConnMgr] SSID expired for user ${session.userId} → BLOCKED`);
    transitionTo(session, "BLOCKED");
    updateSsidStatus(session.userId, "EXPIRED").catch(() => {}); // Update DB status
    SystemLogger.warn("ConnectionManager", `SSID expired for user ${session.userId} — awaiting Bridge sync`);
  });

  // Error → schedule reconnect
  session.client.onError((err) => {
    if (session.state === "READY") {
      console.warn(`[ConnMgr] Client error for user ${session.userId}: ${err.message}`);
      transitionTo(session, "RECONNECTING");
      _scheduleReconnect(session);
    }
  });
}

// ── Reconnect Scheduler ────────────────────────────────────────────────────────
function _scheduleReconnect(session: ManagedSession): void {
  if (session.state === "BLOCKED") return;

  const attempt = session.reconnectAttempts;
  const delay = getBackoff(attempt);
  session.reconnectAttempts++;

  // After 5 attempts → COOLDOWN for 60s then stop
  if (attempt >= 5) {
    transitionTo(session, "COOLDOWN");
    session.cooldownUntil = Date.now() + 60 * 1000; // 60s cooldown
    invalidateHostCache();
    console.warn(`[ConnMgr] User ${session.userId} entered COOLDOWN (60s) after ${attempt} attempts — STOPPING retries`);

    // Emit cooldown event with remaining time
    connectionEvents.emit("connection:cooldown", { userId: session.userId, cooldownMs: 60000 });

    setTimeout(() => {
      if (session.state === "COOLDOWN") {
        transitionTo(session, "IDLE");
        session.reconnectAttempts = 0;
        console.log(`[ConnMgr] User ${session.userId} COOLDOWN over — ready for next sync`);
        connectionEvents.emit("connection:cooldown-over", { userId: session.userId });
      }
    }, 60 * 1000);
    return;
  }

  console.log(`[ConnMgr] Scheduling reconnect for user ${session.userId} in ${Math.round(delay / 1000)}s (attempt ${attempt + 1}/5)`);

  setTimeout(async () => {
    if (session.state === "BLOCKED" || session.state === "COOLDOWN") return;
    transitionTo(session, "RECONNECTING");
    await humanDelay(200, 600);

    try {
      await session.client.connect(session.isDemo);
      transitionTo(session, "READY");
      session.connectedAt = Date.now();
      session.reconnectAttempts = 0;
      console.log(`[ConnMgr] ✅ User ${session.userId} reconnected`);
      // Emit bridge:connected to trigger bot resume
      connectionEvents.emit("bridge:connected", { userId: session.userId, isDemo: session.isDemo });
    } catch (err: any) {
      console.warn(`[ConnMgr] Reconnect attempt ${attempt + 1} failed: ${err.message}`);
      transitionTo(session, "RECONNECTING");
      _scheduleReconnect(session);
    }
  }, delay);
}

// ── Session Refresh (Bridge sync) ─────────────────────────────────────────────
/**
 * Called by Bridge sync route to inject a fresh SSID.
 * Unblocks BLOCKED/COOLDOWN sessions instantly.
 */
export async function refreshSession(
  userId: number,
  newSsid: string,
  isDemo: boolean,
  cookies?: string,
  uid?: string
): Promise<PocketOptionClient | null> {
  const existing = sessions.get(userId);

  if (existing) {
    console.log(`[ConnMgr] Bridge refresh for user ${userId} — resetting state from ${existing.state}`);
    transitionTo(existing, "IDLE");
    invalidateHostCache();
    existing.reconnectAttempts = 0;
    existing.cooldownUntil = 0;
    existing.ssidRefreshedAt = Date.now();
    try { existing.client.disconnect(); } catch {}
    sessions.delete(userId);
  }

  return ensureConnected(userId, newSsid, isDemo, cookies, uid);
}

// ── Session Validation (before trade) ─────────────────────────────────────────
export function isSessionReady(userId: number): boolean {
  const session = sessions.get(userId);
  if (!session) return false;
  if (session.state !== "READY") return false;
  if (!session.client.isConnected) return false;

  // Dead session detection: no activity in 2 min while READY
  const silenceSec = (Date.now() - session.lastActivityAt) / 1000;
  if (silenceSec > 120) {
    console.warn(`[ConnMgr] Dead session detected for user ${userId} (${Math.round(silenceSec)}s silence)`);
    transitionTo(session, "RECONNECTING");
    _scheduleReconnect(session);
    return false;
  }

  return true;
}

export function touchSession(userId: number): void {
  const s = sessions.get(userId);
  if (s) s.lastActivityAt = Date.now();
}

// ── Admin: Full Status ─────────────────────────────────────────────────────────
export function getAllSessionStatus(): Record<number, {
  state: ConnectionState;
  isDemo: boolean;
  reconnectAttempts: number;
  uptimeSec: number;
  silenceSec: number;
}> {
  const result: Record<number, any> = {};
  for (const [userId, session] of sessions.entries()) {
    result[userId] = {
      state: session.state,
      isDemo: session.isDemo,
      reconnectAttempts: session.reconnectAttempts,
      uptimeSec: session.connectedAt ? Math.round((Date.now() - session.connectedAt) / 1000) : 0,
      silenceSec: Math.round((Date.now() - session.lastActivityAt) / 1000),
    };
  }
  return result;
}
