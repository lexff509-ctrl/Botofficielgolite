import { BotConnection } from "./connection";
import { BotConfig } from "./types";

let _instance: BotConnection | null = null;

/**
 * Returns the singleton BotConnection, creating and auto-connecting it on
 * first call. Subsequent calls return the same instance regardless of its
 * current connection state — the connection itself handles reconnection.
 *
 * This is intentionally a module-level singleton so that the connection
 * survives hot-reloads in development (via the globalThis cache) and is
 * shared across all server-side callers in production.
 */
export function getBotConnection(
  url: string,
  config?: Partial<BotConfig>
): BotConnection {
  // In Next.js dev mode, preserve the instance across HMR reloads
  const g = globalThis as typeof globalThis & {
    __botConnection?: BotConnection;
  };

  if (g.__botConnection) {
    return g.__botConnection;
  }

  if (!_instance) {
    _instance = new BotConnection(url, config);

    // Attach top-level error listener so unhandled rejections don't crash
    _instance.on("error", (event) => {
      console.error("[BotConnection] error event:", event.payload);
    });

    _instance.on("statusChange", (status: string) => {
      console.info(`[BotConnection] status → ${status}`);
    });

    // Fire-and-forget initial connect — the connection handles retries
    _instance.connect().catch((err) => {
      console.error("[BotConnection] initial connect failed:", err);
    });
  }

  g.__botConnection = _instance;
  return _instance;
}

/**
 * Tear down the singleton — useful in tests or when the bot URL changes.
 */
export async function destroyBotConnection(): Promise<void> {
  const g = globalThis as typeof globalThis & {
    __botConnection?: BotConnection;
  };

  if (g.__botConnection) {
    await g.__botConnection.destroy();
    g.__botConnection = undefined;
  }
  _instance = null;
}
