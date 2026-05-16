/**
 * POST /api/bot/resume
 *
 * Resume the bot runner from a paused state.
 */

import { NextResponse } from "next/server";
import { botRunner } from "@/services/bot-runner";

export async function POST() {
  try {
    await botRunner.resume();
    return NextResponse.json({ ok: true, status: "running" });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
