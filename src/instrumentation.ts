// Next.js instrumentation file - runs on server startup
// Recovers active bot sessions after server restart

export async function register() {
  // Only run on the server (not during build)
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { recoverActiveSessions } = await import("@/lib/bootstrap");
    const { SystemLogger } = await import("@/lib/system-logger");

    // Intercept global console.error to save important errors to DB
    const originalConsoleError = console.error;
    console.error = (...args: any[]) => {
      originalConsoleError.apply(console, args);
      
      // Avoid logging Next.js internal build errors, spam, or DB SSL warnings (which cause infinite recursion)
      const message = args.map(a => typeof a === 'object' ? (a?.message || JSON.stringify(a)) : String(a)).join(" ");
      if (
        !message.includes("ExperimentalWarning") && 
        !message.includes("punycode") &&
        !message.includes("SECURITY WARNING: The SSL modes") &&
        !message.includes("uselibpqcompat") &&
        !message.includes("libpq-ssl.html")
      ) {
        SystemLogger.error("System/Node", message, args);
      }
    };

    // Global Crash Protection
    process.on("uncaughtException", (err) => {
      console.error("[CRASH] Uncaught Exception:", err);
      SystemLogger.error("System/Crash", "Uncaught Exception", { error: err.message, stack: err.stack });
    });

    process.on("unhandledRejection", (reason, promise) => {
      console.error("[CRASH] Unhandled Rejection at:", promise, "reason:", reason);
      SystemLogger.error("System/Crash", "Unhandled Rejection", { reason: String(reason) });
    });

    // ─── Auto-migration: Add missing columns safely (idempotent) ────────────
    // Runs on every startup. IF NOT EXISTS means it's safe to run multiple times.
    import("@/db").then(async ({ db }) => {
      try {
        const { sql } = await import("drizzle-orm");
        await db.execute(sql`
          ALTER TABLE users
            ADD COLUMN IF NOT EXISTS extension_active BOOLEAN NOT NULL DEFAULT false,
            ADD COLUMN IF NOT EXISTS live_balance NUMERIC(15,2) DEFAULT '0.00',
            ADD COLUMN IF NOT EXISTS pocket_option_username VARCHAR(100),
            ADD COLUMN IF NOT EXISTS cooldown_until TIMESTAMP,
            ADD COLUMN IF NOT EXISTS profit_target NUMERIC(15,2),
            ADD COLUMN IF NOT EXISTS loss_limit NUMERIC(15,2),
            ADD COLUMN IF NOT EXISTS backtesting_days_granted INTEGER DEFAULT 0
        `);
        console.log("[Migration] Auto-migration OK — all columns verified");
      } catch (err: any) {
        // Non-fatal: log but don't crash the server
        console.warn("[Migration] Auto-migration warning:", err.message);
      }
    }).catch(() => {});

    // Lancer la récupération en arrière-plan sans bloquer le démarrage du serveur Next.js
    // Render a besoin que le serveur réponde rapidement sur le port HTTP (timeout)
    recoverActiveSessions()
      .then((result) => {
        if (result.recovered > 0 || result.failed > 0) {
          console.log(`[Bootstrap] Recovered ${result.recovered} sessions, ${result.failed} failed`);
          if (result.errors.length > 0) {
            console.warn("[Bootstrap] Errors:", result.errors);
          }
        }
      })
      .catch((err) => {
        console.error("[Bootstrap] Failed:", err);
      });
  }
}

