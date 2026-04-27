import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { users, trades, paymentRequests } from "@/db/schema";
import { getUserFromRequest, handleApiError } from "@/lib/auth";

export async function GET(req: NextRequest) {
  try {
    const adminPayload = getUserFromRequest(req);
    if (!adminPayload || adminPayload.role !== "ADMIN") {
      return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
    }

    const allUsers = await db.select().from(users);
    const allTrades = await db.select().from(trades);
    const allPayments = await db.select().from(paymentRequests);

    const totalUsers = allUsers.length;
    const activeUsers = allUsers.filter((u) => u.subscriptionStatus === "ACTIVE").length;
    const trialUsers = allUsers.filter((u) => u.subscriptionStatus === "TRIAL").length;
    const pendingPayments = allPayments.filter((p) => p.status === "PENDING").length;
    const approvedRevenue = allPayments
      .filter((p) => p.status === "APPROVED")
      .reduce((acc, p) => acc + parseFloat(p.amount), 0);

    const totalTrades = allTrades.length;
    const wins = allTrades.filter((t) => t.result === "WIN").length;
    const winRate = totalTrades > 0 ? (wins / totalTrades) * 100 : 0;

    return NextResponse.json({
      stats: {
        totalUsers,
        activeUsers,
        trialUsers,
        expiredUsers: allUsers.filter((u) => u.subscriptionStatus === "EXPIRED").length,
        freeUsers: allUsers.filter((u) => u.subscriptionStatus === "FREE").length,
        pendingPaymentUsers: allUsers.filter((u) => u.subscriptionStatus === "PENDING_PAYMENT").length,
        pendingPayments,
        approvedRevenue: parseFloat(approvedRevenue.toFixed(2)),
        totalTrades,
        winRate: parseFloat(winRate.toFixed(2)),
      },
    });
  } catch (error) {
    return handleApiError(error, "Admin Stats");
  }
}
