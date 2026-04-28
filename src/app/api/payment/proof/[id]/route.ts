import { NextRequest, NextResponse } from "next/server";
import { readFile, stat } from "fs/promises";
import { join } from "path";
import { db } from "@/db";
import { paymentRequests } from "@/db/schema";
import { eq } from "drizzle-orm";

const CONTENT_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const paymentId = parseInt(id);

    // Get payment record to find proof path
    const [payment] = await db
      .select()
      .from(paymentRequests)
      .where(eq(paymentRequests.id, paymentId));

    if (!payment?.proofFilePath) {
      return NextResponse.json({ error: "Preuve non trouvée" }, { status: 404 });
    }

    const filename = payment.proofFilePath.split("/").pop();
    if (!filename) {
      return NextResponse.json({ error: "Chemin invalide" }, { status: 400 });
    }

    const filepath = join(process.cwd(), "uploads", "proofs", filename);

    // Security: ensure file exists and is within uploads directory
    try {
      const fileStat = await stat(filepath);
      if (!fileStat.isFile()) {
        return NextResponse.json({ error: "Fichier invalide" }, { status: 400 });
      }
    } catch {
      return NextResponse.json({ error: "Fichier non trouvé" }, { status: 404 });
    }

    const buffer = await readFile(filepath);
    const ext = filename.split(".").pop() || "jpg";
    const contentType = CONTENT_TYPES[ext] || "image/jpeg";

    return new NextResponse(buffer, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch {
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
