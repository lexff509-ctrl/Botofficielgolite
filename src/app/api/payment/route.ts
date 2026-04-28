import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest, handleApiError } from "@/lib/auth";
import { hasActiveSubscription } from "@/services/payment.service";
import { createPaymentRequest, getPayments, getWalletAddress } from "@/services/payment.service";

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
    const { amount, planMonths, txHash, proofFilePath } = body;

    if (!amount || parseFloat(amount) <= 0) {
      return NextResponse.json({ error: "Montant invalide" }, { status: 400 });
    }
    if (!txHash && !proofFilePath) {
      return NextResponse.json({ error: "Hash de transaction ou preuve image requis" }, { status: 400 });
    }

    const payment = await createPaymentRequest(
      payload.userId,
      parseFloat(amount),
      planMonths || 1,
      txHash || "",
      proofFilePath
    );

    return NextResponse.json({ success: true, payment });
  } catch (error) {
    return handleApiError(error, "Payment POST");
  }
}
