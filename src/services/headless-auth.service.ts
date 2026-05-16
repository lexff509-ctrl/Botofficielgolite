import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { decryptSSID } from "@/lib/auth"; // Reuse encryption logic for password

// Ajout du plugin Stealth pour contourner Cloudflare
puppeteer.use(StealthPlugin());

export class HeadlessAuthService {
  /**
   * Se connecte silencieusement à PocketOption et récupère un SSID frais
   */
  public static async autoLogin(userId: number): Promise<string | null> {
    // Récupérer les identifiants spécifiques au client
    const [user] = await db.select().from(users).where(eq(users.id, userId));
    
    if (!user || !user.poEmail || !user.poPassword) {
      console.error(`[HeadlessAuth] Email ou mot de passe non configuré pour le client ${userId}.`);
      return null;
    }

    const targetEmail = user.poEmail;
    const targetPassword = decryptSSID(user.poPassword); // Le mot de passe est stocké crypté

    if (!targetPassword) {
      console.error(`[HeadlessAuth] Impossible de décrypter le mot de passe pour le client ${userId}.`);
      return null;
    }

    console.log(`[HeadlessAuth] Lancement du navigateur fantôme pour l'utilisateur ${userId}...`);
    
    let browser;
    try {
      browser = await puppeteer.launch({
        headless: true, // true en prod, false pour débugger
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-blink-features=AutomationControlled',
        ],
        // executablePath: process.env.PUPPETEER_EXECUTABLE_PATH // Nécessaire sur Railway/Render parfois
      });

      const page = await browser.newPage();
      
      // Simuler un vrai utilisateur (User-Agent)
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
      
      // 1. Aller sur la page de login
      console.log("[HeadlessAuth] Navigation vers PocketOption...");
      await page.goto('https://pocketoption.com/fr/login/', { waitUntil: 'networkidle2', timeout: 30000 });

      // 2. Remplir le formulaire
      console.log("[HeadlessAuth] Remplissage des identifiants...");
      await page.waitForSelector('input[name="email"]', { timeout: 10000 });
      await page.type('input[name="email"]', targetEmail, { delay: 100 });
      await page.type('input[type="password"]', targetPassword, { delay: 100 });

      // 3. Cliquer sur le bouton de connexion (il faut trouver le bon selecteur)
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }),
        page.click('button[type="submit"]')
      ]);

      console.log("[HeadlessAuth] Connexion réussie, extraction du SSID...");

      // 4. Extraire le cookie de session
      const cookies = await page.cookies();
      const sessionCookie = cookies.find(c => c.name === 'PHPSESSID' || c.name === 'session_id');

      if (!sessionCookie) {
        throw new Error("Cookie de session introuvable après login.");
      }

      const ssid = sessionCookie.value;
      
      // 5. Sauvegarder dans la BDD pour l'utilisateur
      await db.update(users)
        .set({ 
          pocketOptionSsid: ssid, 
          ssidStatus: "VALID",
          updatedAt: new Date()
        })
        .where(eq(users.id, userId));

      console.log(`[HeadlessAuth] ✅ SSID frais récupéré et sauvegardé pour l'utilisateur ${userId}`);
      return ssid;

    } catch (error: any) {
      console.error("[HeadlessAuth] ❌ Échec de la connexion fantôme :", error.message);
      return null;
    } finally {
      if (browser) {
        await browser.close();
      }
    }
  }
}
