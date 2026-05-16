/**
 * GET /api/bot/status
 *
 * Returns the current bot state snapshot.
 */

import { NextResponse } from "next/server";
import { botRunner } from "@/services/bot-runner";

export async function GET() {
  return NextResponse.json(botRunner.getState());
}
