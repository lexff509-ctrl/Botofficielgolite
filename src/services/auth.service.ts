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
  tradeMode: string;
  demoBalance: string | null;
  pocketOptionSsid: string | null;
  backtestingDaysGranted: number | null;
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
  });

  return { token, user: mapUser(newUser) };
}

export async function loginUser(
  email: string,
  password: string
): Promise<{ token: string; user: UserProfile } | { error: string; status: number }> {
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.email, email.toLowerCase()));

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

  const token = signToken({
    userId: user.id,
    email: user.email,
    role: user.role,
    subscriptionStatus,
  });

  return { token, user: { ...mapUser(user), subscriptionStatus } };
}

export async function getUserProfile(userId: number): Promise<UserProfile | null> {
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.id, userId));
  return user ? mapUser(user) : null;
}

export async function updateProfile(
  userId: number,
  data: { username?: string; tradeMode?: string; pocketOptionSsid?: string }
): Promise<UserProfile | null> {
  const updates: Record<string, unknown> = {};
  if (data.username) updates.username = data.username;
  if (data.tradeMode) updates.tradeMode = data.tradeMode;
  if (data.pocketOptionSsid !== undefined) {
    updates.pocketOptionSsid = data.pocketOptionSsid
      ? encryptSSID(data.pocketOptionSsid)
      : null;
  }

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
