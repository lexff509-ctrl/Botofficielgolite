import { NextRequest, NextResponse } from "next/server";
import { loginSchema } from "@/lib/validation";
import { authRateLimit, checkRateLimit } from "@/lib/rate-limit";
import { loginUser } from "@/services/auth.service";
import { setAuthCookie } from "@/lib/auth";

export async function POST(req: NextRequest) {
  // Rate limiting
  const rateLimitResponse = checkRateLimit(req, authRateLimit, "auth");
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const body = await req.json();
    const parsed = loginSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 }
      );
    }

    const { email, password } = parsed.data;
    const result = await loginUser(email, password);

    if ("error" in result) {
      return NextResponse.json(
        { error: result.error },
        { status: result.status }
      );
    }

    const response = NextResponse.json({
      success: true,
      user: {
        id: result.user.id,
        email: result.user.email,
        username: result.user.username,
        role: result.user.role,
        subscriptionStatus: result.user.subscriptionStatus,
        subscriptionExpiresAt: result.user.subscriptionExpiresAt,
        tradeMode: result.user.tradeMode,
        demoBalance: result.user.demoBalance,
      },
    });

    setAuthCookie(response, result.token);
    return response;
  } catch (error) {
    console.error("Login error:", error);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
