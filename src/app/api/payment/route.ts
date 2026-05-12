import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest, handleApiError } from "@/lib/auth";
import { hasActiveSubscription, createPaymentRequest, getPayments, getWalletAddress, MONCASH_PLANS, MONCASH_INFO, reviewPayment } from "@/services/payment.service";
import { db } from "@/db";
import { promoCodes, promoCodeUsage } from "@/db/schema";
import { eq, and, sql } from "drizzle-orm";

// Never expose wallet to frontend - only get payment info
export async function GET(req: NextRequest) {
  try {
    const payload = getUserFromRequest(req);
    if (!payload) {
      return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
    }

    const payments = await getPayments(payload.userId);

    return NextResponse.json({
      payments,
      plans: {
        MONTHLY: { months: 1, price: 50, label: "1 Mois" },
        QUARTERLY: { months: 3, price: 280, label: "3 Mois", savings: "Économisez 20$" },
        ANNUAL: { months: 12, price: 1250, label: "12 Mois", savings: "Économisez 350$" },
      },
      moncashPlans: MONCASH_PLANS,
      moncashInfo: MONCASH_INFO,
      currency: "USDT TRC20",
    });
  } catch (error) {
    return handleApiError(error, "Payment GET");
  }
}

export async function POST(req: NextRequest) {
  try {
    const payload = getUserFromRequest(req);
    if (!payload) {
      return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
    }

    const body = await req.json();
    const { amount, planMonths, txHash, proofFilePath, currency, moncashSenderPhone, moncashValidationName, promoCode } = body;

    let appliedAmount = parseFloat(amount);
    let isAutoApprove = false;
    let validPromoId: number | null = null;

    // Check Promo Code if provided
    if (promoCode) {
      const [promo] = await db.select().from(promoCodes).where(and(eq(promoCodes.code, promoCode.toUpperCase()), eq(promoCodes.isActive, true)));
      if (promo) {
        if (promo.maxUses === null || promo.currentUses < promo.maxUses) {
          validPromoId = promo.id;
          if (promo.discountPercent >= 100) {
            isAutoApprove = true;
            appliedAmount = 0; // Free
          } else {
            appliedAmount = appliedAmount * (1 - promo.discountPercent / 100);
          }
        }
      }
    }

    if (!isAutoApprove && appliedAmount <= 0) {
      return NextResponse.json({ error: "Montant invalide" }, { status: 400 });
    }

    // For USDT: require txHash or proof
    // For MonCash: require sender phone
    const isMoncash = currency === "MONCASH";
    if (!isAutoApprove && !isMoncash && !txHash && !proofFilePath) {
      return NextResponse.json({ error: "Hash de transaction ou preuve image requis" }, { status: 400 });
    }
    if (!isAutoApprove && isMoncash && !moncashSenderPhone) {
      return NextResponse.json({ error: "Numéro de téléphone MonCash requis" }, { status: 400 });
    }

    const payment = await createPaymentRequest(
      payload.userId,
      appliedAmount,
      planMonths || 1,
      txHash || (isAutoApprove ? "PROMO_CODE_100%" : ""),
      proofFilePath,
      currency || "USDT",
      isMoncash ? moncashSenderPhone : undefined,
      isMoncash ? moncashValidationName : undefined,
    );

    if (validPromoId) {
      // Increment uses
      await db.update(promoCodes).set({ currentUses: sql`${promoCodes.currentUses} + 1` }).where(eq(promoCodes.id, validPromoId));
      await db.insert(promoCodeUsage).values({ promoCodeId: validPromoId, userId: payload.userId });
    }

    if (isAutoApprove) {
      await reviewPayment(payload.userId, payment.id, "APPROVED", `Auto-approuvé via code promo: ${promoCode}`);
      return NextResponse.json({ success: true, payment, autoApproved: true });
    }

    return NextResponse.json({ success: true, payment });
  } catch (error) {
    return handleApiError(error, "Payment POST");
  }
}
