// src/services/trade-mutex.manager.ts
import { SystemLogger } from "@/lib/system-logger";
import { redis } from "@/lib/redis";

class TradeMutexManager {
  // --- MUTEX LOCKS ---
  // Store the expiration timestamp of the lock for memory fallback
  private locks = new Map<string, number>();

  /**
   * Acquire a lock. Distributed via Redis if available, else memory.
   * Returns true if successfully acquired. Returns false if already locked.
   * Lock expires automatically after `timeoutMs` to prevent deadlocks.
   */
  async acquireLock(key: string, timeoutMs: number = 60000): Promise<boolean> {
    // 1. Try Redis Lock (Production)
    if (redis) {
      try {
        const result = await redis.set(key, "locked", "PX", timeoutMs, "NX");
        return result === "OK";
      } catch (err) {
        console.warn(`[Mutex] Redis failed, falling back to memory:`, err);
      }
    }

    // 2. Memory Fallback
    const now = Date.now();
    const existingExpiration = this.locks.get(key);
    if (existingExpiration && now < existingExpiration) {
      return false; // Still locked
    }
    this.locks.set(key, now + timeoutMs);
    return true;
  }

  async releaseLock(key: string): Promise<void> {
    if (redis) {
      try {
        await redis.del(key);
      } catch (err) {
        console.warn(`[Mutex] Redis release failed:`, err);
      }
    }
    this.locks.delete(key);
  }

  // --- COOLDOWN SYSTEM ---
  // Store the expiration timestamp of the cooldown
  private cooldowns = new Map<string, number>();

  /**
   * Set a strict cooldown period.
   */
  setCooldown(key: string, durationMs: number): void {
    const expiration = Date.now() + durationMs;
    this.cooldowns.set(key, expiration);
  }

  isCooldownActive(key: string): boolean {
    const expiration = this.cooldowns.get(key);
    if (!expiration) return false;
    
    if (Date.now() < expiration) {
      return true;
    } else {
      // Clean up expired cooldown
      this.cooldowns.delete(key);
      return false;
    }
  }

  getCooldownRemaining(key: string): number {
    const expiration = this.cooldowns.get(key);
    if (!expiration) return 0;
    return Math.max(0, expiration - Date.now());
  }

  // --- HELPER KEYS ---
  
  getTradeKey(userId: number, asset: string, timeframe: string): string {
    return `trade_lock:${userId}:${asset}:${timeframe}`;
  }

  getCooldownKey(userId: number, asset: string, timeframe: string): string {
    return `cooldown:${userId}:${asset}:${timeframe}`;
  }
}

export const tradeMutexManager = new TradeMutexManager();
