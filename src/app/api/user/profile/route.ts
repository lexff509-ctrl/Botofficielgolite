import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest, handleApiError } from "@/lib/auth";
import { profileUpdateSchema } from "@/lib/validation";
import { updateProfile } from "@/services/auth.service";

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

    return NextResponse.json({
      success: true,
      user: {
        id: updated.id,
        email: updated.email,
        username: updated.username,
        role: updated.role,
        subscriptionStatus: updated.subscriptionStatus,
        tradeMode: updated.tradeMode,
        demoBalance: updated.demoBalance,
      },
    });
  } catch (error) {
    return handleApiError(error, "Profile update");
  }
}
