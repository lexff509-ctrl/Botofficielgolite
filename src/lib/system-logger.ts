import { db } from "@/db";
import { systemLogs } from "@/db/schema";

type LogLevel = "INFO" | "WARN" | "ERROR";

export class SystemLogger {
  private static async log(level: LogLevel, source: string, message: string, details?: any) {
    // Print to console regardless
    // Skip console.error if source is System/Node to prevent infinite recursion 
    // with the console.error interceptor in instrumentation.ts
    if (level === "ERROR") {
      if (source !== "System/Node") {
        console.error(`[${source}] ${message}`, details || "");
      }
    }
    else if (level === "WARN") console.warn(`[${source}] ${message}`, details || "");
    else console.log(`[${source}] ${message}`, details || "");

    try {
      let detailsString: string | null = null;
      if (details) {
        if (details instanceof Error) {
          detailsString = details.stack || details.message;
        } else if (typeof details === "object") {
          detailsString = JSON.stringify(details, null, 2);
        } else {
          detailsString = String(details);
        }
      }

      await db.insert(systemLogs).values({
        level,
        source,
        message,
        details: detailsString,
      });

      // ── Étape 3.3 : Notification Discord sur erreur CRITICAL/ERROR ──
      if (level === "ERROR" && process.env.DISCORD_WEBHOOK_URL) {
        fetch(process.env.DISCORD_WEBHOOK_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            content: `🚨 **ERROR** | ${source}\n\`\`\`${message}\n${detailsString ? detailsString.substring(0, 1000) : ''}\`\`\``
          })
        }).catch(() => {}); // Fire and forget
      }

    } catch (e) {
      // Do not crash the app if logging fails, and DO NOT use console.error here
      // as it would trigger an infinite recursion loop with instrumentation.ts
      console.log("[SystemLogger] Failed to save log to DB:", e);
    }
  }

  public static info(source: string, message: string, details?: any) {
    return this.log("INFO", source, message, details);
  }

  public static warn(source: string, message: string, details?: any) {
    return this.log("WARN", source, message, details);
  }

  public static error(source: string, message: string, details?: any) {
    return this.log("ERROR", source, message, details);
  }
}
