// ============================================================
// Tokento — Rate Limit Middleware
// ============================================================
// Per-merchant/per-agent rate limiting via Redis sliding window.
// Rates from shared constants: 100/min query, 20/min validate, 10/min redeem.

import { Request, Response, NextFunction } from 'express';
import { RATE_LIMITS, CACHE_TTL } from '@tokento/shared';
import redis from '../db/redis';
import { logger } from '../utils/logger';

type RateLimitTier = keyof typeof RATE_LIMITS;

/**
 * Rate limit middleware using Redis sliding window counter.
 */
/** Tiers that move value. A limiter outage must not become an open door. */
const FAIL_CLOSED_TIERS: ReadonlySet<RateLimitTier> = new Set(['REDEEM', 'MINT'] as RateLimitTier[]);

export function rateLimit(tier: RateLimitTier = 'DEFAULT') {
  const limit = RATE_LIMITS[tier];
  const windowMs = CACHE_TTL.RATE_LIMIT_WINDOW * 1000;
  const failClosed = FAIL_CLOSED_TIERS.has(tier);

  const unavailable = (req: Request, res: Response, next: NextFunction): void => {
    if (!failClosed) {
      next();
      return;
    }
    res.status(503).json({
      error: {
        code: 'rate_limit_unavailable',
        message: 'Rate limiting is unavailable; value-moving operations are refused.',
      },
      requestId: req.requestId || 'unknown',
    });
  };

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      // Key on the authenticated principal. Falling back to req.ip for every caller
      // put all customers in one bucket behind a load balancer — trivially bypassed by
      // rotating source IPs, and usable as a denial-of-service against everyone else.
      // Requires `trust proxy` (set in index.ts) for req.ip to be meaningful.
      const identifier = req.merchantId || req.customerId || req.ip || 'unknown';
      const key = `ratelimit:${tier}:${identifier}`;
      const now = Date.now();
      const windowStart = now - windowMs;

      // Sliding window using Redis sorted set
      const pipeline = redis.pipeline();
      pipeline.zremrangebyscore(key, 0, windowStart);
      pipeline.zadd(key, now.toString(), `${now}-${Math.random()}`);
      pipeline.zcard(key);
      pipeline.pexpire(key, windowMs);

      const results = await pipeline.exec();

      if (!results) {
        logger.warn({ tier, failClosed }, 'Rate limit: Redis unavailable');
        unavailable(req, res, next);
        return;
      }

      const count = (results[2]?.[1] as number) || 0;

      // Set rate limit headers
      res.setHeader('X-RateLimit-Limit', limit);
      res.setHeader('X-RateLimit-Remaining', Math.max(0, limit - count));
      res.setHeader('X-RateLimit-Reset', Math.ceil((now + windowMs) / 1000));

      // zadd runs before zcard, so `count` includes the current request: blocking at
      // count > limit admits exactly `limit` requests per window, which is correct.
      if (count > limit) {
        res.status(429).json({
          error: {
            code: 'rate_limit_exceeded',
            message: `Rate limit exceeded. Maximum ${limit} requests per minute for ${tier.toLowerCase()} operations.`,
            details: {
              limit,
              remaining: 0,
              resetAt: new Date(now + windowMs).toISOString(),
            },
          },
          requestId: req.requestId || 'unknown',
        });
        return;
      }

      next();
    } catch (err) {
      logger.error({ err, tier, failClosed }, 'Rate limit middleware error');
      unavailable(req, res, next);
    }
  };
}
