import { NextResponse } from "next/server";
import { getBotConnection } from "@/lib/bot/autoConnect";

const BOT_WS_URL = process.env.BOT_WS_URL ?? "ws://localhost:8080/bot";

export async function GET() {
  try {
    const bot = getBotConnection(BOT_WS_URL);
    return NextResponse.json({
      status: bot.status,
      isConnected: bot.isConnected,
      timestamp: Date.now(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
