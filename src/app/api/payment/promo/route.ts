import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest, handleApiError } from "@/lib/auth";
import { db } from "@/db";
import { promoCodes } from "@/db/schema";
import { eq, and } from "drizzle-orm";

export async function POST(req: NextRequest) {
  try {
    const user = getUserFromRequest(req);
    if (!user) {
      return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
    }

    const { code } = await req.json();
    if (!code) {
      return NextResponse.json({ error: "Code requis" }, { status: 400 });
    }

    const [promo] = await db.select().from(promoCodes).where(and(eq(promoCodes.code, code.toUpperCase()), eq(promoCodes.isActive, true)));

    if (!promo) {
      return NextResponse.json({ error: "Code promo invalide" }, { status: 404 });
    }

    if (promo.maxUses !== null && promo.currentUses >= promo.maxUses) {
      return NextResponse.json({ error: "Ce code promo a atteint sa limite d'utilisation" }, { status: 400 });
    }

    return NextResponse.json({ success: true, discountPercent: promo.discountPercent, promoId: promo.id });
  } catch (error) {
    return handleApiError(error, "Promo Validation POST");
  }
}
