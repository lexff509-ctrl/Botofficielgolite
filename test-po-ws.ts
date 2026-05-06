import { PocketOptionClient } from './src/lib/pocketoption/client';
import { getBestHost } from './src/lib/pocketoption/connection';
import { db } from './src/db';
import { platformSettings, users } from './src/db/schema';
import { eq } from 'drizzle-orm';
import { decryptSSID } from './src/lib/auth';

/**
 * Test de connexion PocketOption
 * Lit le SSID depuis la DB (SSID global admin ou SSID utilisateur)
 * Usage: npx ts-node test-po-ws.ts [userId]
 */
async function testConnection() {
  console.log("Démarrage du test de connexion PocketOption...");

  // --- Récupérer le SSID depuis la DB ---
  let ssid = '';

  // 1. Essayer le SSID global (admin)
  const [globalRow] = await db
    .select({ value: platformSettings.value })
    .from(platformSettings)
    .where(eq(platformSettings.key, 'global_ssid'));

  if (globalRow?.value) {
    ssid = decryptSSID(globalRow.value);
    console.log("✅ SSID global (admin) trouvé en DB");
  }

  // 2. Si userId fourni en argument, utiliser son SSID personnel
  const userIdArg = parseInt(process.argv[2] ?? '');
  if (!isNaN(userIdArg) && userIdArg > 0) {
    const [user] = await db
      .select({ pocketOptionSsid: users.pocketOptionSsid })
      .from(users)
      .where(eq(users.id, userIdArg));

    if (user?.pocketOptionSsid) {
      ssid = decryptSSID(user.pocketOptionSsid);
      console.log(`✅ SSID personnel trouvé pour userId=${userIdArg}`);
    }
  }

  if (!ssid) {
    console.error("❌ Aucun SSID trouvé en DB.");
    console.error("   → Configurez un SSID global via le panneau admin,");
    console.error("   → ou passez un userId: npx ts-node test-po-ws.ts <userId>");
    process.exit(1);
  }

  console.log(`SSID utilisé (masqué): ${ssid.substring(0, 40)}...`);

  const client = new PocketOptionClient(ssid);

  try {
    const bestHost = await getBestHost(true); // isDemo = true
    console.log("Meilleur hôte trouvé :", bestHost);

    await client.connect(true);

    console.log("✅ Connexion réussie ! IsConnected:", client.isConnected);

    // Attendre 5 secondes pour voir les événements passer
    await new Promise(r => setTimeout(r, 5000));

    client.disconnect();
    console.log("Déconnecté.");
    process.exit(0);
  } catch (err) {
    console.error("❌ Erreur de connexion :", err);
    process.exit(1);
  }
}

testConnection();
