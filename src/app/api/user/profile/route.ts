import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest, handleApiError } from "@/lib/auth";
import { profileUpdateSchema } from "@/lib/validation";
import { updateProfile } from "@/services/auth.service";
import { connectPocketOption, decryptSSID } from "@/services/trading.service";

export async function PUT(req: NextRequest) {
  try {
    const payload = getUserFromRequest(req);
    if (!payload) {
      return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
    }

    const body = await req.json();
    const parsed = profileUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 }
      );
    }

    const updated = await updateProfile(payload.userId, parsed.data);
    if (!updated) {
      return NextResponse.json({ error: "Aucune modification" }, { status: 400 });
    }

    // If SSID was updated, try to connect immediately to validate and seed data
    if (parsed.data.pocketOptionSsid) {
      const isDemo = updated.tradeMode === "DEMO";
      const rawSsid = decryptSSID(updated.pocketOptionSsid);
      if (rawSsid) {
        console.log(`[Profile] Auto-connecting PO for user ${payload.userId} after SSID update`);
        // We don't await this to keep profile update fast, but it will update status in DB
        connectPocketOption(payload.userId, rawSsid, isDemo).catch(err => {
          console.error(`[Profile] Auto-connect failed:`, err);
        });
      }
    }

    return NextResponse.json({
      success: true,
      user: {
        id: updated.id,
        email: updated.email,
        username: updated.username,
        role: updated.role,
        subscriptionStatus: updated.subscriptionStatus,
        tradeMode: updated.tradeMode,
        pocketOptionUid: updated.pocketOptionUid,
        demoBalance: updated.demoBalance,
        profitTarget: updated.profitTarget,
        lossLimit: updated.lossLimit,
      },
    });
  } catch (error) {
    return handleApiError(error, "Profile update");
  }
}
