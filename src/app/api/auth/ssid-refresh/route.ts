import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest, handleApiError } from "@/lib/auth";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { connectPocketOption, getGlobalSsid } from "@/services/trading.service";
import { getUserProfile, getDecryptedSSID } from "@/services/auth.service";

export async function POST(req: NextRequest) {
  try {
    const payload = getUserFromRequest(req);
    if (!payload) {
      return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
    }

    const { mode = "DEMO" } = await req.json();

    if (!["DEMO", "LIVE"].includes(mode)) {
      return NextResponse.json(
        { error: "Mode invalide: doit être DEMO ou LIVE" },
        { status: 400 }
      );
    }

    console.log(`[SSID Refresh] Tentative de re-synchronisation pour user ${payload.userId} (${mode})...`);

    // Step 1: Get current SSID
    let ssid = "";
    const profile = await getUserProfile(payload.userId);

    if (profile?.pocketOptionSsid) {
      ssid = getDecryptedSSID(profile);
    }

    // Fallback to global SSID
    if (!ssid) {
      ssid = await getGlobalSsid();
    }

    if (!ssid) {
      return NextResponse.json(
        {
          error: "Aucun SSID disponible",
          suggestion: "Veuillez configurer un SSID personnel ou contactez l'administrateur",
        },
        { status: 400 }
      );
    }

    // Step 2: Attempt PocketOption connection
    const result = await connectPocketOption(payload.userId, ssid, mode === "DEMO");

    // Step 3: Update user SSID status based on result
    if (result.success) {
      await db
        .update(users)
        .set({
          ssidStatus: "VALID",
          updatedAt: new Date(),
        })
        .where(eq(users.id, payload.userId));

      console.log(`[SSID Refresh] ✅ SSID synchronisé avec succès pour user ${payload.userId}`);

      return NextResponse.json({
        success: true,
        message: "SSID resynchronisé avec succès",
        ssidStatus: "VALID",
        mode: mode,
      });
    } else {
      let newStatus = "UNKNOWN";
      if (result.ssidExpired) {
        newStatus = "EXPIRED";
      }

      await db
        .update(users)
        .set({
          ssidStatus: newStatus,
          updatedAt: new Date(),
        })
        .where(eq(users.id, payload.userId));

      console.warn(
        `[SSID Refresh] ❌ Échec SSID pour user ${payload.userId}: ${result.error}`
      );

      return NextResponse.json(
        {
          success: false,
          error: result.error || "Échec de la resynchronisation SSID",
          ssidStatus: newStatus,
          suggestion: newStatus === "EXPIRED"
            ? "Votre SSID a expiré. Veuillez vous reconnecter à PocketOption."
            : "Vérifiez votre connexion réseau et réessayez.",
        },
        { status: 400 }
      );
    }
  } catch (error) {
    console.error(`[SSID Refresh] Exception:`, error);
    return handleApiError(error, "SSID Refresh POST");
  }
}

export async function GET(req: NextRequest) {
  try {
    const payload = getUserFromRequest(req);
    if (!payload) {
      return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
    }

    const profile = await getUserProfile(payload.userId);
    const ssidStatus = profile?.ssidStatus || "UNKNOWN";

    return NextResponse.json({
      ssidStatus,
      lastUpdated: profile?.updatedAt,
      hasPersonalSsid: !!profile?.pocketOptionSsid,
      suggestion: ssidStatus === "EXPIRED"
        ? "Cliquez sur 'Resynchroniser SSID' pour mettre à jour"
        : undefined,
    });
  } catch (error) {
    return handleApiError(error, "SSID Refresh GET");
  }
}
