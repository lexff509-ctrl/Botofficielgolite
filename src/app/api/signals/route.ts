import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest, handleApiError } from "@/lib/auth";
import { signalRequestSchema } from "@/lib/validation";
import { signalRateLimit, checkRateLimit } from "@/lib/rate-limit";
import { hasActiveSubscription } from "@/services/payment.service";
import { generateAndSaveSignal, getRecentSignals } from "@/services/trading.service";

export async function GET(req: NextRequest) {
  try {
    const payload = getUserFromRequest(req);
    if (!payload) {
      return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
    }

    const hasAccess = await hasActiveSubscription(payload.userId);
    if (!hasAccess) {
      return NextResponse.json(
        { error: "Abonnement requis pour accéder aux signaux" },
        { status: 403 }
      );
    }

    const recent = await getRecentSignals(payload.userId);
    return NextResponse.json({ signals: recent });
  } catch (error) {
    return handleApiError(error, "Signals GET");
  }
}

export async function POST(req: NextRequest) {
  try {
    const payload = getUserFromRequest(req);
    if (!payload) {
      return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
    }

    // Rate limiting for signal generation
    const rateLimitResponse = checkRateLimit(req, signalRateLimit, "signal");
    if (rateLimitResponse) return rateLimitResponse;

    const body = await req.json();
    const parsed = signalRequestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 }
      );
    }

    const { asset, timeframe } = parsed.data;

    const result = await generateAndSaveSignal(payload.userId, asset, timeframe);

    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: 200 });
    }

    return NextResponse.json({ signal: result.saved, raw: result.signal });
  } catch (error) {
    return handleApiError(error, "Signals POST");
  }
}
