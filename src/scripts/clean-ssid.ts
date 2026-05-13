import "dotenv/config";
import { db } from "../db";
import { users, platformSettings } from "../db/schema";
import { eq } from "drizzle-orm";

async function clearCorruptedSSID() {
  console.log("=========================================");
  console.log("🧹 NETTOYAGE DES SSID CORROMPUS EN BDD 🧹");
  console.log("=========================================\n");

  try {
    // 1. Nettoyer les users
    const allUsers = await db.select().from(users);
    let usersCleaned = 0;
    
    for (const u of allUsers) {
      if (u.pocketOptionSsid && u.pocketOptionSsid.length > 500) {
        // Un SSID normal (même crypté) fait moins de 200 caractères
        // Si c'est > 500, c'est le fameux prompt IA copié par erreur !
        await db.update(users).set({ pocketOptionSsid: null }).where(eq(users.id, u.id));
        usersCleaned++;
        console.log(`✅ SSID corrompu supprimé pour l'utilisateur ID: ${u.id} (${u.email})`);
      }
    }

    // 2. Nettoyer le SSID Global
    const globalSsidRows = await db.select().from(platformSettings).where(eq(platformSettings.key, "global_ssid"));
    let globalCleaned = 0;
    if (globalSsidRows.length > 0) {
      const gSsid = globalSsidRows[0].value;
      if (gSsid && gSsid.length > 500) {
        await db.delete(platformSettings).where(eq(platformSettings.key, "global_ssid"));
        await db.delete(platformSettings).where(eq(platformSettings.key, "global_ssid_status"));
        globalCleaned++;
        console.log(`✅ SSID Global corrompu supprimé des paramètres de plateforme.`);
      }
    }

    if (usersCleaned === 0 && globalCleaned === 0) {
      console.log("👍 Aucun SSID corrompu (géant) n'a été trouvé. Tout est propre.");
    } else {
      console.log("\n🎉 NETTOYAGE TERMINÉ. Veuillez redémarrer le bot et saisir un vrai SSID Pocket Option court.");
    }

  } catch (err: any) {
    console.error("Erreur lors du nettoyage:", err.message);
  }
  process.exit(0);
}

clearCorruptedSSID();
