import { Redis } from 'ioredis';

const redisUrl = process.env.REDIS_URL;

/**
 * Client Redis pour la persistence distribuée sur Railway
 * Si REDIS_URL n'est pas définie, le système basculera sur le cache mémoire
 */
export const redis = redisUrl 
  ? new Redis(redisUrl, { 
      maxRetriesPerRequest: 3,
      connectTimeout: 10000,
      reconnectOnError: (err) => {
        const targetError = 'READONLY';
        if (err.message.includes(targetError)) return true;
        return false;
      }
    }) 
  : null;

if (redis) {
  redis.on('error', (err) => {
    if (process.env.NODE_ENV === 'production') {
      console.warn('[Redis] Error:', err.message);
    }
  });
  redis.on('connect', () => console.log('[Redis] Connected to Railway Redis'));
}

/**
 * Helper pour le cache distribué
 */
export async function setCache(key: string, value: string, ttlSeconds: number): Promise<void> {
  if (redis) {
    await redis.set(key, value, 'EX', ttlSeconds);
  }
}

export async function getCache(key: string): Promise<string | null> {
  return redis ? await redis.get(key) : null;
}
