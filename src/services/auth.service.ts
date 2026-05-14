import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import {
  signToken,
  hashPassword,
  comparePassword,
  encryptSSID,
  decryptSSID,
} from "@/lib/auth";
import type { JWTPayload } from "@/lib/auth";

export interface UserProfile {
  id: number;
  email: string;
  username: string;
  role: string;
  subscriptionStatus: string;
  subscriptionExpiresAt: Date | null;
  trialUsed: boolean;
  isActive: boolean;
  isVerified: boolean;
  tradeMode: string;
  demoBalance: string | null;
  demoTradeAmount: string | null;
  liveTradeAmount: string | null;
  pocketOptionUid: string | null;
  pocketOptionSsid: string | null;
  ssidStatus: string;
  backtestingDaysGranted: number | null;
  profitTarget: string | null;
  lossLimit: string | null;
  extensionApiKey: string | null;
  extensionLastSync: Date | null;
  extensionDeviceName: string | null;
  extensionActive: boolean;
  liveBalance: string | null;
  pocketOptionUsername: string | null;
  createdAt: Date;
}

// Mapping function
function mapUser(user: typeof users.$inferSelect): UserProfile {
  return {
    ...user,
    subscriptionExpiresAt: user.subscriptionExpiresAt ? new Date(user.subscriptionExpiresAt) : null,
    createdAt: user.createdAt ? new Date(user.createdAt) : new Date(),
  };
}

export async function registerUser(
  email: string,
  password: string,
  username: string
): Promise<{ token: string; user: UserProfile }> {
  const hashedPassword = await hashPassword(password);

  // Trial: 3 days
  const trialExpires = new Date();
  trialExpires.setDate(trialExpires.getDate() + 3);

  const [newUser] = await db
    .insert(users)
    .values({
      email: email.toLowerCase(),
      password: hashedPassword,
      username,
      role: "CLIENT",
      subscriptionStatus: "TRIAL",
      subscriptionExpiresAt: trialExpires,
      trialUsed: true,
      isActive: true,
      tradeMode: "DEMO",
      demoBalance: "10000.00",
    })
    .returning();

  const token = signToken({
    userId: newUser.id,
    email: newUser.email,
    role: newUser.role,
    subscriptionStatus: newUser.subscriptionStatus,
    sessionVersion: newUser.sessionVersion || 0,
  });

  return { token, user: mapUser(newUser) };
}

export async function loginUser(
  identifier: string, // email or pocketOptionUid
  password: string
): Promise<{ token: string; user: UserProfile } | { error: string; status: number }> {
  // Try to find user by email first
  let [user] = await db
    .select()
    .from(users)
    .where(eq(users.email, identifier.toLowerCase()));

  // If not found, try by PocketOption UID
  if (!user) {
    [user] = await db
      .select()
      .from(users)
      .where(eq(users.pocketOptionUid, identifier));
  }

  if (!user) {
    return { error: "Identifiants incorrects", status: 401 };
  }

  if (!user.isActive) {
    return { error: "Compte désactivé. Contactez l'admin.", status: 403 };
  }

  const isValid = await comparePassword(password, user.password);
  if (!isValid) {
    return { error: "Identifiants incorrects", status: 401 };
  }

  // Check subscription expiration
  let subscriptionStatus = user.subscriptionStatus;
  if (
    user.subscriptionExpiresAt &&
    new Date() > user.subscriptionExpiresAt &&
    (subscriptionStatus === "TRIAL" || subscriptionStatus === "ACTIVE")
  ) {
    subscriptionStatus = "EXPIRED";
    await db
      .update(users)
      .set({ subscriptionStatus: "EXPIRED" })
      .where(eq(users.id, user.id));
  }

  // Increment session version to invalidate previous sessions (single-device enforcement)
  const newSessionVersion = (user.sessionVersion || 0) + 1;
  await db
    .update(users)
    .set({ sessionVersion: newSessionVersion, updatedAt: new Date() })
    .where(eq(users.id, user.id));

  const token = signToken({
    userId: user.id,
    email: user.email,
    role: user.role,
    subscriptionStatus,
    sessionVersion: newSessionVersion,
  });

  return { token, user: { ...mapUser(user), subscriptionStatus } };
}

export async function getUserProfile(userId: number): Promise<UserProfile | null> {
  let [user] = await db
    .select()
    .from(users)
    .where(eq(users.id, userId));

  if (!user) return null;

  // Auto-generate extension API key if missing
  if (!user.extensionApiKey) {
    const newApiKey = `evt_live_${Math.random().toString(36).substring(2, 15)}${Math.random().toString(36).substring(2, 15)}`;
    await db.update(users).set({ extensionApiKey: newApiKey }).where(eq(users.id, userId));
    user.extensionApiKey = newApiKey;
  }

  return mapUser(user);
}

export async function updateProfile(
  userId: number,
  data: {
    username?: string;
    tradeMode?: string;
    pocketOptionUid?: string;
    pocketOptionSsid?: string;
    demoTradeAmount?: string;
    liveTradeAmount?: string;
    profitTarget?: number | null;
    lossLimit?: number | null;
  }
): Promise<UserProfile | null> {
  const updates: Record<string, unknown> = {};
  if (data.username) updates.username = data.username;
  if (data.tradeMode) updates.tradeMode = data.tradeMode;
  if (data.pocketOptionUid !== undefined) updates.pocketOptionUid = data.pocketOptionUid;
  if (data.pocketOptionSsid !== undefined) {
    updates.pocketOptionSsid = data.pocketOptionSsid
      ? encryptSSID(data.pocketOptionSsid)
      : null;
    updates.ssidStatus = data.pocketOptionSsid ? "UNKNOWN" : "NOT_SET";
  }
  if (data.demoTradeAmount !== undefined) updates.demoTradeAmount = data.demoTradeAmount;
  if (data.liveTradeAmount !== undefined) updates.liveTradeAmount = data.liveTradeAmount;
  if (data.profitTarget !== undefined) updates.profitTarget = data.profitTarget ? String(data.profitTarget) : null;
  if (data.lossLimit !== undefined) updates.lossLimit = data.lossLimit ? String(data.lossLimit) : null;

  if (Object.keys(updates).length === 0) return null;

  const [updated] = await db
    .update(users)
    .set(updates)
    .where(eq(users.id, userId))
    .returning();

  return updated ? mapUser(updated) : null;
}

export function getDecryptedSSID(user: UserProfile): string {
  return decryptSSID(user.pocketOptionSsid);
}

// Single-device session enforcement: check if the JWT's sessionVersion matches the DB
export async function validateSessionVersion(
  userId: number,
  tokenSessionVersion: number
): Promise<boolean> {
  const [user] = await db
    .select({ sessionVersion: users.sessionVersion })
    .from(users)
    .where(eq(users.id, userId));

  if (!user) return false;
  return (user.sessionVersion || 0) === tokenSessionVersion;
}

// Auth wrapper for routes
export type AuthResult =
  | { success: true; payload: JWTPayload }
  | { success: false; response: Response };

export function createAuthError(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
