/**
 * POST /api/bot/stop
 *
 * Stops the bot runner and disconnects all connections.
 */

import { NextResponse } from "next/server";
import { botRunner } from "@/services/bot-runner";

export async function POST() {
  try {
    await botRunner.stop();
    return NextResponse.json({ ok: true, status: "stopped" });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
