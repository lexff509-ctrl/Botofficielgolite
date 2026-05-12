import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest, handleApiError } from "@/lib/auth";
import { db } from "@/db";
import { promoCodes } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import { z } from "zod";

const createPromoSchema = z.object({
  code: z.string().min(3).max(50).toUpperCase(),
  discountPercent: z.number().int().min(1).max(100),
  maxUses: z.number().int().min(1).nullable(),
});

export async function GET(req: NextRequest) {
  try {
    const user = getUserFromRequest(req);
    if (!user || user.role !== "ADMIN") {
      return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
    }

    const promos = await db.select().from(promoCodes).orderBy(desc(promoCodes.createdAt));
    return NextResponse.json({ promos });
  } catch (error) {
    return handleApiError(error, "Admin Promos GET");
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = getUserFromRequest(req);
    if (!user || user.role !== "ADMIN") {
      return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
    }

    const body = await req.json();
    const parsed = createPromoSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }

    const { code, discountPercent, maxUses } = parsed.data;

    // Check if code exists
    const existing = await db.select().from(promoCodes).where(eq(promoCodes.code, code));
    if (existing.length > 0) {
      return NextResponse.json({ error: "Ce code promo existe déjà" }, { status: 400 });
    }

    const [newPromo] = await db.insert(promoCodes).values({
      code,
      discountPercent,
      maxUses,
      createdBy: user.userId,
      isActive: true,
    }).returning();

    return NextResponse.json({ success: true, promo: newPromo });
  } catch (error) {
    return handleApiError(error, "Admin Promos POST");
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const user = getUserFromRequest(req);
    if (!user || user.role !== "ADMIN") {
      return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    
    if (!id) return NextResponse.json({ error: "ID requis" }, { status: 400 });

    await db.update(promoCodes).set({ isActive: false }).where(eq(promoCodes.id, parseInt(id)));
    
    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error, "Admin Promos DELETE");
  }
}
