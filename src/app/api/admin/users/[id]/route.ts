import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { users, auditLogs } from "@/db/schema";
import { getUserFromRequest, handleApiError } from "@/lib/auth";
import { adminUserUpdateSchema } from "@/lib/validation";
import { eq } from "drizzle-orm";

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const adminPayload = getUserFromRequest(req);
    if (!adminPayload || adminPayload.role !== "ADMIN") {
      return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
    }

    const { id } = await params;
    const userId = parseInt(id);
    if (isNaN(userId)) {
      return NextResponse.json({ error: "ID invalide" }, { status: 400 });
    }

    const body = await req.json();
    const parsed = adminUserUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 }
      );
    }

    const updateData: Record<string, unknown> = { updatedAt: new Date() };
    if (parsed.data.isActive !== undefined) updateData.isActive = parsed.data.isActive;
    if (parsed.data.subscriptionStatus) updateData.subscriptionStatus = parsed.data.subscriptionStatus;
    if (parsed.data.subscriptionExpiresAt) updateData.subscriptionExpiresAt = new Date(parsed.data.subscriptionExpiresAt);
    if (parsed.data.backtestingDaysGranted !== undefined) updateData.backtestingDaysGranted = parsed.data.backtestingDaysGranted;
    if (parsed.data.tradeMode) updateData.tradeMode = parsed.data.tradeMode;
    if (parsed.data.demoBalance) updateData.demoBalance = parsed.data.demoBalance;

    const [updated] = await db
      .update(users)
      .set(updateData)
      .where(eq(users.id, userId))
      .returning();

    if (!updated) {
      return NextResponse.json({ error: "Utilisateur introuvable" }, { status: 404 });
    }

    // Audit log
    await db.insert(auditLogs).values({
      adminId: adminPayload.userId,
      targetUserId: userId,
      action: "USER_UPDATE",
      details: body,
    });

    return NextResponse.json({ success: true, user: updated });
  } catch (error) {
    return handleApiError(error, "Admin User PUT");
  }
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const adminPayload = getUserFromRequest(req);
    if (!adminPayload || adminPayload.role !== "ADMIN") {
      return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
    }

    const { id } = await params;
    const userId = parseInt(id);

    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, userId));

    if (!user) {
      return NextResponse.json({ error: "Utilisateur introuvable" }, { status: 404 });
    }

    return NextResponse.json({ user });
  } catch (error) {
    return handleApiError(error, "Admin User GET");
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const adminPayload = getUserFromRequest(req);
    if (!adminPayload || adminPayload.role !== "ADMIN") {
      return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
    }

    const { id } = await params;
    const userId = parseInt(id);

    await db.update(users)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(users.id, userId));

    await db.insert(auditLogs).values({
      adminId: adminPayload.userId,
      targetUserId: userId,
      action: "USER_DISABLED",
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error, "Admin User DELETE");
  }
}
