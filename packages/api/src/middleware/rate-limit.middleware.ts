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
export function rateLimit(tier: RateLimitTier = 'DEFAULT') {
  const limit = RATE_LIMITS[tier];
  const windowMs = CACHE_TTL.RATE_LIMIT_WINDOW * 1000;

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      // Use merchant ID if available, otherwise use IP
      const identifier = req.merchantId || req.ip || 'unknown';
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
        // Redis unavailable — fail open
        logger.warn('Rate limit: Redis unavailable, failing open');
        next();
        return;
      }

      const count = (results[2]?.[1] as number) || 0;

      // Set rate limit headers
      res.setHeader('X-RateLimit-Limit', limit);
      res.setHeader('X-RateLimit-Remaining', Math.max(0, limit - count));
      res.setHeader('X-RateLimit-Reset', Math.ceil((now + windowMs) / 1000));

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
      // Fail open if Redis is down
      logger.error({ err }, 'Rate limit middleware error — failing open');
      next();
    }
  };
}
