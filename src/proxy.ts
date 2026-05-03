import { NextRequest, NextResponse } from "next/server";
import { verifyTokenAsync } from "@/lib/auth-edge";

// Routes that don't require authentication
const PUBLIC_ROUTES = [
  "/api/auth/login",
  "/api/auth/register",
  "/api/health",
  "/api/admin/setup",
];

// Admin-only routes
const ADMIN_ROUTES = [
  "/api/admin/",
];

export async function proxy(req: NextRequest) {
  const { pathname } = new URL(req.url);

  // Allow public routes
  if (PUBLIC_ROUTES.some((route) => pathname.startsWith(route))) {
    return NextResponse.next();
  }

  // Allow non-API routes (pages)
  if (!pathname.startsWith("/api/")) {
    return NextResponse.next();
  }

  // Check auth token from cookies (httpOnly)
  const token = req.cookies.get("token")?.value;
  if (!token) {
    return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  }

  const payload = await verifyTokenAsync(token);
  if (!payload) {
    return NextResponse.json({ error: "Token invalide ou expiré" }, { status: 401 });
  }

  // Check admin routes
  if (ADMIN_ROUTES.some((route) => pathname.startsWith(route))) {
    if (payload.role !== "ADMIN") {
      return NextResponse.json({ error: "Accès interdit" }, { status: 403 });
    }
  }

  // Attach user info to headers for downstream handlers
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-user-id", String(payload.userId));
  requestHeaders.set("x-user-email", payload.email);
  requestHeaders.set("x-user-role", payload.role);
  requestHeaders.set("x-user-subscription", payload.subscriptionStatus);

  return NextResponse.next({
    request: { headers: requestHeaders },
  });
}

export const config = {
  matcher: ["/api/:path*"],
};
