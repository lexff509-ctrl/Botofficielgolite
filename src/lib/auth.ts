import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";

function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET environment variable is required");
  return secret;
}

function getSSIDEncryptionKey(): string {
  const key = process.env.SSID_ENCRYPTION_KEY;
  if (!key) throw new Error("SSID_ENCRYPTION_KEY environment variable is required");
  return key;
}

const ALGORITHM = "aes-256-cbc";
const IV_LENGTH = 16;

export interface JWTPayload {
  userId: number;
  email: string;
  role: string;
  subscriptionStatus: string;
}

// ============ JWT TOKEN ============

export function signToken(payload: JWTPayload): string {
  return jwt.sign(payload, getJwtSecret(), { expiresIn: "7d" });
}

export function verifyToken(token: string): JWTPayload | null {
  try {
    return jwt.verify(token, getJwtSecret()) as JWTPayload;
  } catch {
    return null;
  }
}

// ============ PASSWORD ============

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export async function comparePassword(
  password: string,
  hash: string
): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

// ============ SSID ENCRYPTION ============

export function encryptSSID(ssid: string): string {
  const iv = crypto.randomBytes(IV_LENGTH);
  const key = Buffer.from(getSSIDEncryptionKey(), "hex");
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(ssid, "utf8", "hex");
  encrypted += cipher.final("hex");
  return iv.toString("hex") + ":" + encrypted;
}

export function decryptSSID(encrypted: string | null): string {
  if (!encrypted) return "";
  try {
    const parts = encrypted.split(":");
    if (parts.length !== 2) return "";
    const iv = Buffer.from(parts[0], "hex");
    const encryptedText = parts[1];
    const key = Buffer.from(getSSIDEncryptionKey(), "hex");
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    let decrypted = decipher.update(encryptedText, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
  } catch {
    return "";
  }
}

// ============ REQUEST AUTH (COOKIE-ONLY) ============

export function getTokenFromRequest(req: NextRequest): string | null {
  return req.cookies.get("token")?.value || null;
}

export function getUserFromRequest(req: NextRequest): JWTPayload | null {
  const token = getTokenFromRequest(req);
  if (!token) return null;
  return verifyToken(token);
}

export function requireAuth(req: NextRequest): JWTPayload {
  const user = getUserFromRequest(req);
  if (!user) throw new Error("UNAUTHORIZED");
  return user;
}

export function requireAdmin(req: NextRequest): JWTPayload {
  const user = requireAuth(req);
  if (user.role !== "ADMIN") throw new Error("FORBIDDEN");
  return user;
}

// ============ COOKIE MANAGEMENT ============

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  maxAge: 7 * 24 * 60 * 60,
  path: "/",
};

export function setAuthCookie(response: NextResponse, token: string): void {
  response.cookies.set("token", token, COOKIE_OPTIONS);
}

export function clearAuthCookie(response: NextResponse): void {
  response.cookies.set("token", "", { ...COOKIE_OPTIONS, maxAge: 0 });
}

// ============ AUTH RESPONSE HELPERS ============

export function authErrorResponse(error: unknown): NextResponse | null {
  if (error instanceof Error) {
    if (error.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
    }
    if (error.message === "FORBIDDEN") {
      return NextResponse.json({ error: "Accès interdit" }, { status: 403 });
    }
  }
  return null;
}

export function handleApiError(error: unknown, context: string): NextResponse {
  const authErr = authErrorResponse(error);
  if (authErr) return authErr;
  console.error(`${context} error:`, error);
  return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
}
