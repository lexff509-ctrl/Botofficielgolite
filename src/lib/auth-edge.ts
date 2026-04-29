// Edge Runtime compatible JWT verification
// Used by middleware (runs in Edge Runtime, not Node.js)
// Uses Web Crypto API via jose instead of jsonwebtoken

import { jwtVerify } from "jose";

const JWT_SECRET = process.env.JWT_SECRET!;

export interface JWTPayload {
  userId: number;
  email: string;
  role: string;
  subscriptionStatus: string;
  sessionVersion: number;
}

function getSecretKey(): Uint8Array {
  return new TextEncoder().encode(JWT_SECRET);
}

export function verifyTokenEdge(token: string): JWTPayload | null {
  // This is async in jose, but middleware needs sync-like behavior
  // We'll use the async version in middleware
  return null; // placeholder, use verifyTokenAsync in middleware
}

export async function verifyTokenAsync(token: string): Promise<JWTPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecretKey());
    return {
      userId: payload.userId as number,
      email: payload.email as string,
      role: payload.role as string,
      subscriptionStatus: payload.subscriptionStatus as string,
      sessionVersion: (payload.sessionVersion as number) || 0,
    };
  } catch {
    return null;
  }
}
