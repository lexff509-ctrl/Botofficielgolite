import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest, handleApiError } from "@/lib/auth";
import { getWalletAddress } from "@/services/payment.service";

// Dedicated endpoint to get wallet address (authenticated, server-side only)
export async function GET(req: NextRequest) {
  try {
    const payload = getUserFromRequest(req);
    if (!payload) {
      return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
    }

    const wallet = getWalletAddress();
    if (!wallet) {
      return NextResponse.json(
        { error: "Configuration de paiement non disponible" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      wallet,
      currency: "USDT TRC20",
      network: "TRC20",
      minAmount: 50,
    });
  } catch (error) {
    return handleApiError(error, "Payment Info");
  }
}
