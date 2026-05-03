import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/auth";
import { adminSettingsSchema } from "@/lib/validation";
import { db } from "@/db";
import { platformSettings } from "@/db/schema";
import { eq } from "drizzle-orm";
import {
  setGlobalSsid,
  clearGlobalSsid,
  getGlobalSsidStatus,
  isSharedClientConnected,
  getSharedClientUserCount,
  connectSharedPocketOption,
  disconnectSharedPocketOption,
} from "@/services/trading.service";

export async function GET(req: NextRequest) {
  try {
    const payload = getUserFromRequest(req);
    if (!payload || payload.role !== "ADMIN") {
      return NextResponse.json({ error: "Acces refuse" }, { status: 403 });
    }

    const globalSsidStatus = await getGlobalSsidStatus();
    const sharedConnected = isSharedClientConnected();
    const sharedUserCount = getSharedClientUserCount();

    // Get payout rate
    const [payoutRow] = await db
      .select({ value: platformSettings.value })
      .from(platformSettings)
      .where(eq(platformSettings.key, "default_payout_rate"));

    return NextResponse.json({
      globalSsidSet: globalSsidStatus !== "NOT_SET",
      globalSsidStatus,
      sharedClientConnected: sharedConnected,
      sharedClientUserCount: sharedUserCount,
      payoutRate: payoutRow ? parseFloat(payoutRow.value) : 0.92,
    });
  } catch (error) {
    return NextResponse.json(
      { error: "Erreur lors du chargement des parametres" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const payload = getUserFromRequest(req);
    if (!payload || payload.role !== "ADMIN") {
      return NextResponse.json({ error: "Acces refuse" }, { status: 403 });
    }

    const body = await req.json();
    const parsed = adminSettingsSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 }
      );
    }

    const { action, globalSsid, payoutRate } = parsed.data;

    if (action === "SET" && globalSsid) {
      // Test the connection first
      const testResult = await connectSharedPocketOption(0, globalSsid, true);
      if (!testResult.success) {
        return NextResponse.json(
          { error: testResult.error || "Echec de connexion avec ce SSID", ssidExpired: testResult.ssidExpired },
          { status: 400 }
        );
      }
      // Connection succeeded - save the SSID
      await setGlobalSsid(globalSsid);
      // Disconnect the test user (userId 0 is not a real user)
      disconnectSharedPocketOption(0);
      return NextResponse.json({ success: true, message: "SSID global configure et valide" });
    }

    if (action === "CLEAR") {
      await clearGlobalSsid();
      return NextResponse.json({ success: true, message: "SSID global supprime" });
    }

    if (action === "SET_PAYOUT_RATE" && payoutRate) {
      const existing = await db
        .select()
        .from(platformSettings)
        .where(eq(platformSettings.key, "default_payout_rate"));
      if (existing.length > 0) {
        await db
          .update(platformSettings)
          .set({ value: String(payoutRate), updatedAt: new Date() })
          .where(eq(platformSettings.key, "default_payout_rate"));
      } else {
        await db.insert(platformSettings).values({
          key: "default_payout_rate",
          value: String(payoutRate),
        });
      }
      return NextResponse.json({ success: true, message: `Taux de paiement mis a jour: ${(payoutRate * 100).toFixed(0)}%` });
    }

    return NextResponse.json({ error: "Action invalide" }, { status: 400 });
  } catch (error) {
    return NextResponse.json(
      { error: "Erreur lors de la mise a jour des parametres" },
      { status: 500 }
    );
  }
}
