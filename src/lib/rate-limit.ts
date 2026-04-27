import { NextRequest, NextResponse } from "next/server";

const rateLimitStore = new Map<string, { count: number; resetAt: number }>();

// Clean up stale entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateLimitStore.entries()) {
    if (now > entry.resetAt) rateLimitStore.delete(key);
  }
}, 5 * 60 * 1000);

interface RateLimitOptions {
  windowMs: number; // time window in milliseconds
  maxRequests: number; // max requests per window
  keyGenerator?: (req: NextRequest) => string;
}

export function rateLimit(options: RateLimitOptions) {
  const { windowMs, maxRequests, keyGenerator } = options;

  const defaultKeyGenerator = (req: NextRequest): string => {
    const ip =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      req.headers.get("x-real-ip") ||
      "127.0.0.1";
    const path = new URL(req.url).pathname;
    return `${ip}:${path}`;
  };

  const getKey = keyGenerator || defaultKeyGenerator;

  return function check(req: NextRequest): {
    allowed: boolean;
    remaining: number;
    resetAt: number;
  } {
    const key = getKey(req);
    const now = Date.now();
    const entry = rateLimitStore.get(key);

    if (!entry || now > entry.resetAt) {
      rateLimitStore.set(key, { count: 1, resetAt: now + windowMs });
      return { allowed: true, remaining: maxRequests - 1, resetAt: now + windowMs };
    }

    entry.count++;
    if (entry.count > maxRequests) {
      return { allowed: false, remaining: 0, resetAt: entry.resetAt };
    }

    return {
      allowed: true,
      remaining: maxRequests - entry.count,
      resetAt: entry.resetAt,
    };
  };
}

// Pre-configured limiters
export const authRateLimit = rateLimit({ windowMs: 60_000, maxRequests: 5 }); // 5 req/min for auth
export const apiRateLimit = rateLimit({ windowMs: 60_000, maxRequests: 60 }); // 60 req/min general
export const signalRateLimit = rateLimit({ windowMs: 60_000, maxRequests: 20 }); // 20 req/min for signals

// Helper to apply rate limit and return error response if exceeded
export function checkRateLimit(
  req: NextRequest,
  limiter: ReturnType<typeof rateLimit>,
  label = "Rate limit"
): NextResponse | null {
  const result = limiter(req);
  if (!result.allowed) {
    return NextResponse.json(
      {
        error: `Trop de requêtes. Réessayez dans ${Math.ceil(
          (result.resetAt - Date.now()) / 1000
        )}s.`,
      },
      {
        status: 429,
        headers: {
          "X-RateLimit-Limit": "5",
          "X-RateLimit-Remaining": "0",
          "X-RateLimit-Reset": String(result.resetAt),
        },
      }
    );
  }
  return null;
}
