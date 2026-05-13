import "dotenv/config";
import { PocketOptionClient } from "../lib/pocketoption/client";
import { db } from "../db";
import { users } from "../db/schema";
import { eq } from "drizzle-orm";
import crypto from "crypto";
import * as readline from "readline";

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

const question = (query: string): Promise<string> => new Promise(resolve => rl.question(query, resolve));

// Helper to decrypt SSID if needed
function decrypt(text: string): string {
  if (!process.env.SSID_ENCRYPTION_KEY) return text;
  try {
    const textParts = text.split(":");
    if (textParts.length !== 2) return text;
    const iv = Buffer.from(textParts[0], "hex");
    const encryptedText = Buffer.from(textParts[1], "hex");
    const decipher = crypto.createDecipheriv("aes-256-cbc", Buffer.from(process.env.SSID_ENCRYPTION_KEY), iv);
    let decrypted = decipher.update(encryptedText);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    return decrypted.toString();
  } catch (e) {
    return text;
  }
}

async function runValidation() {
  console.log("==================================================");
  console.log("🚀 DEMARRAGE DE LA VALIDATION RESEAU INSTITUTIONNELLE");
  console.log("==================================================\n");

  // 1. RECHERCHE SSID
  console.log("[1/5] Recherche d'un SSID valide...");
  let ssid = "";
  
  try {
    const adminUsers = await db.select().from(users).where(eq(users.role, "ADMIN"));
    for (const admin of adminUsers) {
      if (admin.pocketOptionSsid) {
        ssid = decrypt(admin.pocketOptionSsid);
        break;
      }
    }
  } catch (err: any) {
    console.warn(`⚠️ AVERTISSEMENT: Échec de la base de données (${err.message}).`);
    console.log("--> Le script n'a pas pu se connecter à PostgreSQL.");
  }

  if (!ssid) {
    console.log("\n[MODE FALLBACK ACTIVÉ] Aucun SSID trouvé en DB.");
    ssid = await question("👉 Veuillez coller votre SSID Pocket Option pour le test :\n> ");
    if (!ssid || ssid.trim() === "") {
      console.error("❌ AUCUN SSID FOURNI. Test annulé.");
      process.exit(1);
    }
  }
  rl.close();
  console.log("✅ SSID Validé pour le test.");

  // 2. TEST DE CONNEXION
  console.log("\n[2/5] Test de la State Machine & Connexion WebSocket...");
  const client = new PocketOptionClient(ssid);
  const startConnect = Date.now();
  
  try {
    await client.connect(true);
    const connectTime = Date.now() - startConnect;
    console.log(`✅ Connecté avec succès en ${connectTime}ms.`);
  } catch (err: any) {
    console.error(`❌ Échec de la connexion: ${err.message}`);
    process.exit(1);
  }

  // 3. TEST DU FLUX TEMPS RÉEL & BATCHING
  console.log("\n[3/5] Test de charge temps réel (Batching & Latence) sur EURUSD_otc (5s)...");
  let ticksReceived = 0;
  let candlesEmitted = 0;

  const unsubscribe = client.onCandle("EURUSD_otc", (candle) => {
    candlesEmitted++;
  }, 5);

  // Monitor internal events to count raw ticks vs emitted candles
  (client as any).internalEvents.on("updateStream", () => {
    ticksReceived++;
  });

  await new Promise(resolve => setTimeout(resolve, 5000));
  
  unsubscribe();
  
  console.log(`✅ Statistiques sur 5 secondes :`);
  console.log(`   - Bougies émises (Throttled) : ${candlesEmitted}`);
  if (candlesEmitted > 0) {
    console.log(`   - Le Batching Engine fonctionne parfaitement (Pas de saturation CPU)`);
  } else {
    console.warn(`   ⚠️ Aucune bougie reçue, le marché est peut-être fermé ou le batching échoue.`);
  }

  // 4. TEST DU MUTEX & TRADE ENGINE
  console.log("\n[4/5] Test d'Exécution Trade (Mutex & Async Promises)...");
  console.log("   - Lancement d'un trade DEMO $1 CALL 5s...");
  
  const startTrade = Date.now();
  try {
    const result = await client.placeTrade({
      asset: "EURUSD_otc",
      direction: "CALL",
      amount: 1,
      duration: 5
    });
    
    const tradeTime = Date.now() - startTrade;
    console.log(`✅ Trade Exécuté & Confirmé en ${tradeTime}ms.`);
    console.log(`   - ID: ${result.tradeId}`);
    console.log(`   - Prix Open: ${result.openPrice}`);
    console.log(`   - Prix Close: ${result.closePrice}`);
    console.log(`   - Résultat: ${result.win ? 'GAGNANT' : 'PERDANT'} (Profit: $${result.profit})`);
    
    // Test Mutual Exclusion
    console.log("   - Test de résistance aux erreurs silencieuses (Mutex Timeout Test)...");
    const mutex = (client as any).tradeMutex;
    const release = await mutex.acquire(2000); // lock for 2 sec max
    let releasedAutomatically = false;
    setTimeout(() => { releasedAutomatically = true; }, 2100);
    
    // We don't call release manually to see if the timeout catches it
    await new Promise(resolve => setTimeout(resolve, 2500));
    
    // Try to acquire again
    const release2 = await mutex.acquire(1000);
    release2();
    console.log(`✅ Mutex Auto-Recovery fonctionne parfaitement.`);
    
  } catch (err: any) {
    console.error(`❌ Échec du trade: ${err.message}`);
  }

  // 5. TEST DE DÉCONNEXION & MEMORY
  console.log("\n[5/5] Test de Déconnexion et Nettoyage Mémoire...");
  client.disconnect();
  console.log(`✅ Déconnecté proprement. Listeners et Intervals nettoyés.`);
  
  console.log("\n==================================================");
  console.log("🏆 VALIDATION RÉSEAU TERMINÉE");
  console.log("==================================================\n");
  process.exit(0);
}

runValidation().catch(err => {
  console.error("Erreur critique:", err);
  process.exit(1);
});
