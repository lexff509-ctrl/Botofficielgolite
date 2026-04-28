// Next.js instrumentation file - runs on server startup
// Recovers active bot sessions after server restart

export async function register() {
  // Only run on the server (not during build)
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { recoverActiveSessions } = await import("@/lib/bootstrap");
    try {
      const result = await recoverActiveSessions();
      if (result.recovered > 0 || result.failed > 0) {
        console.log(
          `[Bootstrap] Recovered ${result.recovered} sessions, ${result.failed} failed`
        );
        if (result.errors.length > 0) {
          console.warn("[Bootstrap] Errors:", result.errors);
        }
      }
    } catch (err) {
      console.error("[Bootstrap] Failed:", err);
    }
  }
}
