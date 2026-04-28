import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest, handleApiError } from "@/lib/auth";
import { writeFile, mkdir } from "fs/promises";
import { join } from "path";

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];

export async function POST(req: NextRequest) {
  try {
    const payload = getUserFromRequest(req);
    if (!payload) {
      return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
    }

    const formData = await req.formData();
    const file = formData.get("proof") as File | null;

    if (!file) {
      return NextResponse.json({ error: "Fichier requis" }, { status: 400 });
    }

    if (!ALLOWED_TYPES.includes(file.type)) {
      return NextResponse.json(
        { error: "Format invalide. Acceptés: JPG, PNG, WebP" },
        { status: 400 }
      );
    }

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: "Fichier trop volumineux (max 5MB)" },
        { status: 400 }
      );
    }

    // Ensure uploads directory exists
    const uploadsDir = join(process.cwd(), "uploads", "proofs");
    await mkdir(uploadsDir, { recursive: true });

    // Generate unique filename
    const ext = file.type.split("/")[1];
    const filename = `${payload.userId}_${Date.now()}.${ext}`;
    const filepath = join(uploadsDir, filename);

    // Write file
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    await writeFile(filepath, buffer);

    return NextResponse.json({
      success: true,
      proofFilePath: `/uploads/proofs/${filename}`,
    });
  } catch (error) {
    return handleApiError(error, "Proof Upload");
  }
}
