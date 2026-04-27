import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { paymentRequests, users, auditLogs } from "@/db/schema";
import { getUserFromRequest, handleApiError } from "@/lib/auth";
import { paymentReviewSchema } from "@/lib/validation";
import { eq, desc } from "drizzle-orm";
import { reviewPayment, getPayments } from "@/services/payment.service";

export async function GET(req: NextRequest) {
  try {
    const adminPayload = getUserFromRequest(req);
    if (!adminPayload || adminPayload.role !== "ADMIN") {
      return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
    }

    const payments = await db
      .select({
        id: paymentRequests.id,
        userId: paymentRequests.userId,
        amount: paymentRequests.amount,
        currency: paymentRequests.currency,
        txHash: paymentRequests.txHash,
        proofFilePath: paymentRequests.proofFilePath,
        status: paymentRequests.status,
        planMonths: paymentRequests.planMonths,
        adminNote: paymentRequests.adminNote,
        reviewedAt: paymentRequests.reviewedAt,
        reviewedBy: paymentRequests.reviewedBy,
        createdAt: paymentRequests.createdAt,
        userEmail: users.email,
        username: users.username,
      })
      .from(paymentRequests)
      .leftJoin(users, eq(paymentRequests.userId, users.id))
      .orderBy(desc(paymentRequests.createdAt));

    return NextResponse.json({ payments });
  } catch (error) {
    return handleApiError(error, "Admin Payments GET");
  }
}

export async function PUT(req: NextRequest) {
  try {
    const adminPayload = getUserFromRequest(req);
    if (!adminPayload || adminPayload.role !== "ADMIN") {
      return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
    }

    const body = await req.json();
    const parsed = paymentReviewSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 }
      );
    }

    const { paymentId, status, note } = parsed.data;

    const result = await reviewPayment(adminPayload.userId, paymentId, status, note);
    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    // Audit log
    const [payment] = await db
      .select()
      .from(paymentRequests)
      .where(eq(paymentRequests.id, paymentId));

    await db.insert(auditLogs).values({
      adminId: adminPayload.userId,
      targetUserId: payment?.userId,
      action: `PAYMENT_${status === "APPROVED" ? "APPROVE" : "REJECT"}`,
      details: { paymentId, note },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error, "Admin Payments PUT");
  }
}
