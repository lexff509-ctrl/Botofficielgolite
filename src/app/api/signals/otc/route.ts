import { NextResponse } from "next/server";
import { getOTCConnection } from "@/lib/signals/otcConnection";

const OTC_WS_URL = process.env.OTC_WS_URL ?? "ws://localhost:8081/otc";
const OTC_API_KEY = process.env.OTC_API_KEY;

export async function GET() {
  try {
    const otc = getOTCConnection({
      url: OTC_WS_URL,
      apiKey: OTC_API_KEY,
      connectionTimeoutMs: 20_000,
      reconnectBaseDelayMs: 1_500,
      reconnectMaxDelayMs: 45_000,
      maxReconnectAttempts: 15,
      pingIntervalMs: 30_000,
      pongTimeoutMs: 12_000,
    });

    return NextResponse.json({
      status: otc.status,
      isConnected: otc.isConnected,
      timestamp: Date.now(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST() {
  try {
    const otc = getOTCConnection({
      url: OTC_WS_URL,
      apiKey: OTC_API_KEY,
      connectionTimeoutMs: 20_000,
      reconnectBaseDelayMs: 1_500,
      reconnectMaxDelayMs: 45_000,
      maxReconnectAttempts: 15,
      pingIntervalMs: 30_000,
      pongTimeoutMs: 12_000,
    });

    if (!otc.isConnected) {
      otc.connect();
    }

    return NextResponse.json({
      status: otc.status,
      isConnected: otc.isConnected,
      timestamp: Date.now(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
