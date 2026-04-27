import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest, handleApiError } from "@/lib/auth";
import { tradeCreateSchema, paginationSchema } from "@/lib/validation";
import { getUserTrades, executeTrade, getTradeStats } from "@/services/trading.service";

export async function GET(req: NextRequest) {
  try {
    const payload = getUserFromRequest(req);
    if (!payload) {
      return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const parsed = paginationSchema.safeParse({
      limit: searchParams.get("limit") || "50",
      mode: searchParams.get("mode") || undefined,
    });

    const limit = parsed.success ? parsed.data.limit : 50;
    const mode = parsed.success ? parsed.data.mode : undefined;

    const userTrades = await getUserTrades(payload.userId, mode, limit);
    const stats = await getTradeStats(payload.userId);

    return NextResponse.json({ trades: userTrades, stats });
  } catch (error) {
    return handleApiError(error, "Trades GET");
  }
}

export async function POST(req: NextRequest) {
  try {
    const payload = getUserFromRequest(req);
    if (!payload) {
      return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
    }

    const body = await req.json();
    const parsed = tradeCreateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 }
      );
    }

    const result = await executeTrade(payload.userId, parsed.data);

    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json({ trade: result.trade, profit: result.profit });
  } catch (error) {
    return handleApiError(error, "Trades POST");
  }
}
