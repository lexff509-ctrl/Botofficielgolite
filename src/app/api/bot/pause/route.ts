/**
 * POST /api/bot/pause
 * POST /api/bot/resume
 *
 * Pause or resume the bot runner without disconnecting.
 */

import { NextResponse } from "next/server";
import { botRunner } from "@/services/bot-runner";

export async function POST() {
  try {
    await botRunner.pause("api request");
    return NextResponse.json({ ok: true, status: "paused" });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
