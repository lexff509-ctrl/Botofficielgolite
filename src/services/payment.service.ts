import { db } from "@/db";
import { paymentRequests, users } from "@/db/schema";
import { eq, desc, and } from "drizzle-orm";

// ============ SUBSCRIPTION PLANS ============

export const SUBSCRIPTION_PLANS = {
  MONTHLY: { months: 1, price: 50, label: "1 Mois", savings: "" },
  QUARTERLY: { months: 3, price: 280, label: "3 Mois", savings: "Économisez 20$" },
  ANNUAL: { months: 12, price: 1250, label: "12 Mois", savings: "Économisez 350$" },
};

export type PlanKey = keyof typeof SUBSCRIPTION_PLANS;

// ============ PAYMENT MANAGEMENT ============

export async function getPayments(
  userId?: number,
  status?: string,
  limit = 50
) {
  const conditions = [];
  if (userId) conditions.push(eq(paymentRequests.userId, userId));
  if (status) conditions.push(eq(paymentRequests.status, status as "PENDING" | "APPROVED" | "REJECTED"));

  return db
    .select()
    .from(paymentRequests)
    .where(and(...conditions))
    .orderBy(desc(paymentRequests.createdAt))
    .limit(limit);
}

export async function createPaymentRequest(
  userId: number,
  amount: number,
  planMonths: number,
  txHash: string,
  currency = "USDT"
) {
  const [payment] = await db
    .insert(paymentRequests)
    .values({
      userId,
      amount: String(amount),
      currency,
      txHash,
      planMonths,
      status: "PENDING",
    })
    .returning();
  return payment;
}

export async function reviewPayment(
  adminId: number,
  paymentId: number,
  status: "APPROVED" | "REJECTED",
  note?: string
): Promise<{ success: boolean; error?: string }> {
  const [payment] = await db
    .select()
    .from(paymentRequests)
    .where(eq(paymentRequests.id, paymentId));

  if (!payment) return { success: false, error: "Paiement introuvable" };
  if (payment.status !== "PENDING") return { success: false, error: "Ce paiement a déjà été traité" };

  await db
    .update(paymentRequests)
    .set({
      status,
      adminNote: note || null,
      reviewedAt: new Date(),
      reviewedBy: adminId,
    })
    .where(eq(paymentRequests.id, paymentId));

  // If approved, activate subscription
  if (status === "APPROVED") {
    const now = new Date();
    const expiresAt = new Date(now);
    expiresAt.setMonth(expiresAt.getMonth() + payment.planMonths);

    await db
      .update(users)
      .set({
        subscriptionStatus: "ACTIVE",
        subscriptionExpiresAt: expiresAt,
      })
      .where(eq(users.id, payment.userId));
  }

  return { success: true };
}

// Get TRC20 wallet address (from env, never exposed to frontend directly)
export function getWalletAddress(): string {
  return process.env.TRC20_WALLET || "";
}

// ============ SUBSCRIPTION MANAGEMENT ============

export async function checkSubscriptionExpiration(userId: number) {
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.id, userId));

  if (!user) return;

  if (
    user.subscriptionExpiresAt &&
    new Date() > user.subscriptionExpiresAt &&
    (user.subscriptionStatus === "TRIAL" || user.subscriptionStatus === "ACTIVE")
  ) {
    await db
      .update(users)
      .set({ subscriptionStatus: "EXPIRED" })
      .where(eq(users.id, userId));
  }
}

export async function hasActiveSubscription(userId: number): Promise<boolean> {
  await checkSubscriptionExpiration(userId);
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.id, userId));

  if (!user) return false;
  return user.subscriptionStatus === "ACTIVE" || user.subscriptionStatus === "TRIAL";
}
