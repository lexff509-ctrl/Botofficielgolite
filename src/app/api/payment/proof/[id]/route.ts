import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { paymentRequests } from "@/db/schema";
import { eq } from "drizzle-orm";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const paymentId = parseInt(id);

    const [payment] = await db
      .select()
      .from(paymentRequests)
      .where(eq(paymentRequests.id, paymentId));

    if (!payment?.proofFilePath) {
      return NextResponse.json({ error: "Preuve non trouvée" }, { status: 404 });
    }

    // proofFilePath now stores the full Cloudinary URL
    if (payment.proofFilePath.startsWith("http")) {
      return NextResponse.redirect(payment.proofFilePath);
    }

    // Fallback for any legacy local paths (shouldn't exist after migration)
    return NextResponse.json({ error: "Preuve non trouvée" }, { status: 404 });
  } catch {
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
