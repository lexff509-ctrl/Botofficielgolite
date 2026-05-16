/**
 * POST /api/bot/start
 *
 * Body: BotConfig (JSON)
 * Starts the bot runner with the provided configuration.
 */

import { NextRequest, NextResponse } from "next/server";
import { botRunner } from "@/services/bot-runner";
import type { BotConfig } from "@/types/trading";

export async function POST(req: NextRequest) {
  let config: BotConfig;
  try {
    config = (await req.json()) as BotConfig;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!config.ssid || typeof config.ssid !== "string") {
    return NextResponse.json({ error: "ssid is required" }, { status: 400 });
  }

  try {
    // Non-blocking — start() is async but we return immediately
    botRunner.start(config).catch((err) => {
      console.error("[api/bot/start] Unhandled start error", err);
    });
    return NextResponse.json({ ok: true, status: "starting" });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
