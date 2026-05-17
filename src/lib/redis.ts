import { Redis } from 'ioredis';

// ✅ Bulletproof URL validation
let rawRedisUrl = process.env.REDIS_URL;

// BUG FIX: Railway sometimes provides double quotes or extra space in env vars
if (rawRedisUrl) {
  rawRedisUrl = rawRedisUrl.replace(/"/g, '').trim();
  // Fix "Redis.REDIS_URL" type errors from Railway variable referencing
  if (rawRedisUrl.includes('Redis.REDIS_')) {
    console.error(`[Redis] ERROR: Detected Railway reference placeholder instead of real value: "${rawRedisUrl}"`);
    rawRedisUrl = undefined;
  }
}

const isValidRedisUrl = rawRedisUrl && (rawRedisUrl.startsWith('redis://') || rawRedisUrl.startsWith('rediss://'));

if (rawRedisUrl && !isValidRedisUrl) {
  console.error(`[Redis] CRITICAL: Invalid REDIS_URL format detected: "${rawRedisUrl.substring(0, 20)}...". Must start with redis:// or rediss://`);
}

const redisUrl = isValidRedisUrl ? rawRedisUrl : null;

/**
 * Client Redis pour la persistence distribuée sur Railway
 * Si REDIS_URL n'est pas définie ou invalide, le système basculera sur le cache mémoire (Map)
 */
export const redis = redisUrl 
  ? new Redis(redisUrl, { 
      maxRetriesPerRequest: 1, // Be aggressive in failing so we fallback to memory fast
      connectTimeout: 5000,
      lazyConnect: true, // Don't block startup
      reconnectOnError: (err) => {
        const targetError = 'READONLY';
        if (err.message.includes(targetError)) return true;
        return false;
      }
    }) 
  : null;

// Track connection health
let isRedisAvailable = false;

if (redis) {
  redis.on('error', (err) => {
    isRedisAvailable = false;
    // Silent error in production to prevent log flooding, but warn once
    if (process.env.NODE_ENV === 'production') {
      // Swallowing ENOENT errors which happen with malformed URLs
      if (err.message.includes('ENOENT')) {
        console.error('[Redis] Configuration Error: Host looks like a file path. Check your REDIS_URL.');
      }
    } else {
      console.warn('[Redis] Error:', err.message);
    }
  });

  redis.on('connect', () => {
    isRedisAvailable = true;
    console.log('[Redis] Connected to Railway Redis');
  });

  redis.on('close', () => {
    isRedisAvailable = false;
  });
}

/**
 * Helper pour le cache distribué avec fallback silencieux
 */
export async function setCache(key: string, value: string, ttlSeconds: number): Promise<void> {
  if (redis && isRedisAvailable) {
    try {
      await redis.set(key, value, 'EX', ttlSeconds);
    } catch (err) {
      console.warn(`[Redis] Set failed for ${key}, falling back to memory`);
    }
  }
}

export async function getCache(key: string): Promise<string | null> {
  if (redis && isRedisAvailable) {
    try {
      return await redis.get(key);
    } catch (err) {
      return null;
    }
  }
  return null;
}

/**
 * Check if Redis is actually up and usable
 */
export function isRedisReady(): boolean {
  return !!redis && isRedisAvailable;
}

