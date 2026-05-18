import { Redis } from 'ioredis';

// ✅ Bulletproof URL validation
let rawRedisUrl = process.env.REDIS_URL;

// BUG FIX: Railway sometimes provides double quotes or extra space in env vars
if (rawRedisUrl) {
  rawRedisUrl = rawRedisUrl.replace(/"/g, '').trim();

  // FIX: If user accidentally pasted a command like "redis-cli -u redis://..."
  if (rawRedisUrl.includes('redis://') || rawRedisUrl.includes('rediss://')) {
    const match = rawRedisUrl.match(/(rediss?:\/\/[^\s]+)/);
    if (match) {
      rawRedisUrl = match[1];
    }
  }

  // Fix "Redis.REDIS_URL" type errors from Railway variable referencing
  // Also fix accidental pasting of dashboard URL
  if (rawRedisUrl.includes('Redis.REDIS_') || rawRedisUrl.includes('up.railway.app/dashboard')) {
    console.error(`[Redis] ERROR: Detected invalid value or Railway placeholder: "${rawRedisUrl.substring(0, 50)}..."`);
    rawRedisUrl = undefined;
  }
}

const isValidRedisUrl = rawRedisUrl && (rawRedisUrl.startsWith('redis://') || rawRedisUrl.startsWith('rediss://'));

// Railway also provides individual variables
const redisConfig = {
  host: process.env.REDISHOST || process.env.REDIS_HOST,
  port: parseInt(process.env.REDISPORT || process.env.REDIS_PORT || '6379'),
  username: process.env.REDISUSER || process.env.REDIS_USER,
  password: process.env.REDISPASSWORD || process.env.REDIS_PASSWORD,
};

const hasIndividualConfig = !!(redisConfig.host && redisConfig.password);

if (rawRedisUrl && !isValidRedisUrl) {
  console.error(`[Redis] CRITICAL: Invalid REDIS_URL format detected: "${rawRedisUrl.substring(0, 20)}...". Must start with redis:// or rediss://`);
}

/**
 * Client Redis pour la persistence distribuée sur Railway
 * Si REDIS_URL n'est pas définie ou invalide, le système basculera sur le cache mémoire (Map)
 */
export const redis = (isValidRedisUrl && rawRedisUrl) 
  ? new Redis(rawRedisUrl, { 
      maxRetriesPerRequest: 1, 
      connectTimeout: 5000,
      lazyConnect: true,
      reconnectOnError: (err) => err.message.includes('READONLY')
    }) 
  : hasIndividualConfig
  ? new Redis({
      host: redisConfig.host,
      port: redisConfig.port,
      username: redisConfig.username,
      password: redisConfig.password,
      maxRetriesPerRequest: 1,
      connectTimeout: 5000,
      lazyConnect: true,
      reconnectOnError: (err) => err.message.includes('READONLY')
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

export function getRedisStatus() {
  return {
    available: isRedisAvailable,
    usingUrl: isValidRedisUrl,
    usingIndividual: hasIndividualConfig,
    urlPrefix: rawRedisUrl ? rawRedisUrl.substring(0, 15) + "..." : "none",
    host: redisConfig.host || "none",
    error: !isRedisAvailable && (rawRedisUrl || hasIndividualConfig) ? "Connection failed or invalid config" : null
  };
}

