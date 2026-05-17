import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getPocketOptionClient } from "@/services/trading.service";

interface BalanceInfo {
  balance: number;
  source: "pocketoption" | "cache" | "db";
  isValid: boolean;
  lastUpdated: Date;
  warning?: string;
}

// Cache for balance values per user (30s TTL)
const balanceCache = new Map<number, { balance: number; timestamp: number }>();
const BALANCE_CACHE_TTL = 30000; // 30 seconds

export async function validateBalance(
  userId: number,
  requiredAmount: number,
  mode: "DEMO" | "LIVE"
): Promise<{ valid: boolean; balance: BalanceInfo; error?: string }> {
  try {
    // For DEMO, always use DB balance
    if (mode === "DEMO") {
      const user = await db.select().from(users).where(eq(users.id, userId));
      if (user.length === 0) {
        return {
          valid: false,
          balance: {
            balance: 0,
            source: "db",
            isValid: false,
            lastUpdated: new Date(),
          },
          error: "Utilisateur non trouvé",
        };
      }

      const balance = parseFloat(user[0].demoBalance || "0");
      const info: BalanceInfo = {
        balance,
        source: "db",
        isValid: balance >= requiredAmount,
        lastUpdated: new Date(),
      };

      if (!info.isValid) {
        return {
          valid: false,
          balance: info,
          error: `Solde DEMO insuffisant: $${balance.toFixed(2)} < $${requiredAmount.toFixed(2)}`,
        };
      }

      return { valid: true, balance: info };
    }

    // For LIVE: Try PO first, fallback to cache then DB
    const poClient = getPocketOptionClient(userId);

    // Check cache first
    const cached = balanceCache.get(userId);
    if (cached && Date.now() - cached.timestamp < BALANCE_CACHE_TTL) {
      const info: BalanceInfo = {
        balance: cached.balance,
        source: "cache",
        isValid: cached.balance >= requiredAmount,
        lastUpdated: new Date(cached.timestamp),
      };

      if (!info.isValid) {
        return {
          valid: false,
          balance: info,
          error: `Solde insuffisant (cache): $${cached.balance.toFixed(2)} < $${requiredAmount.toFixed(2)}`,
        };
      }

      return { valid: true, balance: info };
    }

    // Try PocketOption if connected
    if (poClient && poClient.isConnected) {
      try {
        const poBalance = await poClient.getBalance();
        if (poBalance !== null && poBalance !== undefined) {
          let balanceNum = 0;

          // Handle different return types
          if (typeof poBalance === "number") {
            balanceNum = poBalance;
          } else if (typeof poBalance === "string") {
            balanceNum = parseFloat(poBalance);
          } else if (typeof poBalance === "object" && "live" in poBalance) {
            // If it's an object with demo/live properties, use live
            balanceNum = parseFloat((poBalance as any).live || "0");
          } else {
            balanceNum = 0;
          }

          if (!isNaN(balanceNum)) {
            // Update cache
            balanceCache.set(userId, {
              balance: balanceNum,
              timestamp: Date.now(),
            });

            const info: BalanceInfo = {
              balance: balanceNum,
              source: "pocketoption",
              isValid: balanceNum >= requiredAmount,
              lastUpdated: new Date(),
            };

            if (!info.isValid) {
              return {
                valid: false,
                balance: info,
                error: `Solde LIVE insuffisant: $${balanceNum.toFixed(2)} < $${requiredAmount.toFixed(2)}`,
              };
            }

            return { valid: true, balance: info };
          }
        }
      } catch (err) {
        console.warn(`[BalanceValidator] Failed to get PO balance:`, err);
        // Fall through to cache/DB fallback
      }
    }

    // Fallback to cache or DB
    if (cached) {
      const info: BalanceInfo = {
        balance: cached.balance,
        source: "cache",
        isValid: cached.balance >= requiredAmount,
        lastUpdated: new Date(cached.timestamp),
        warning: "Balance de cache (data ancienne)",
      };

      if (!info.isValid) {
        return {
          valid: false,
          balance: info,
          error: `Solde insuffisant (cache): $${cached.balance.toFixed(2)} < $${requiredAmount.toFixed(2)}`,
        };
      }

      return { valid: true, balance: info };
    }

    // Final fallback: DB
    const user = await db.select().from(users).where(eq(users.id, userId));
    if (user.length === 0) {
      return {
        valid: false,
        balance: {
          balance: 0,
          source: "db",
          isValid: false,
          lastUpdated: new Date(),
        },
        error: "Utilisateur non trouvé",
      };
    }

    const balance = parseFloat(user[0].liveBalance || "0");
    const info: BalanceInfo = {
      balance,
      source: "db",
      isValid: balance >= requiredAmount,
      lastUpdated: new Date(user[0].updatedAt),
      warning: "Balance DB locale - PO non disponible",
    };

    if (!info.isValid) {
      return {
        valid: false,
        balance: info,
        error: `Solde insuffisant: $${balance.toFixed(2)} < $${requiredAmount.toFixed(2)}`,
      };
    }

    return { valid: true, balance: info };
  } catch (error) {
    console.error("[BalanceValidator] Exception:", error);
    return {
      valid: false,
      balance: {
        balance: 0,
        source: "db",
        isValid: false,
        lastUpdated: new Date(),
      },
      error: "Erreur validation solde",
    };
  }
}

export function updateBalanceCache(userId: number, balance: number): void {
  balanceCache.set(userId, {
    balance,
    timestamp: Date.now(),
  });
}

export function clearBalanceCache(userId: number): void {
  balanceCache.delete(userId);
}

export function getBalanceFromCache(userId: number): number | null {
  const cached = balanceCache.get(userId);
  if (cached && Date.now() - cached.timestamp < BALANCE_CACHE_TTL) {
    return cached.balance;
  }
  return null;
}
