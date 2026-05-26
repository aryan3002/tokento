// ============================================================
// Tokento — Idempotency Middleware
// ============================================================
// Dedicated idempotency layer (Revision #8).
// 24hr TTL, generic middleware handles idempotency for any endpoint.

import { Request, Response, NextFunction } from 'express';
import { IDEMPOTENCY } from '@tokento/shared';
import prisma from '../db/client';
import { logger } from '../utils/logger';

/**
 * Idempotency middleware.
 * If an Idempotency-Key header is present, check if we've already processed this request.
 * If yes, return the cached response. If no, process and cache.
 */
export function idempotency() {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const idempotencyKey = req.headers[IDEMPOTENCY.HEADER_NAME.toLowerCase()] as string;

    if (!idempotencyKey) {
      // No idempotency key — process normally
      next();
      return;
    }

    const key = `${req.method}:${req.path}:${idempotencyKey}`;

    try {
      // Check for existing record
      const existing = await prisma.idempotencyRecord.findUnique({
        where: { key },
      });

      if (existing) {
        // Check if expired
        if (new Date() > existing.expiresAt) {
          // Expired — delete and process normally
          await prisma.idempotencyRecord.delete({ where: { key } });
        } else {
          // Return cached response
          logger.debug({ key }, 'Idempotent request — returning cached response');
          res.status(existing.responseCode).json(existing.responseBody);
          return;
        }
      }

      // Override res.json to cache the response
      const originalJson = res.json.bind(res);
      res.json = function (body: unknown) {
        // Cache the response asynchronously
        const expiresAt = new Date();
        expiresAt.setHours(expiresAt.getHours() + IDEMPOTENCY.KEY_TTL_HOURS);

        prisma.idempotencyRecord
          .create({
            data: {
              key,
              method: req.method,
              endpoint: req.path,
              responseCode: res.statusCode,
              responseBody: body as object,
              expiresAt,
            },
          })
          .catch((err: unknown) => {
            logger.error({ err, key }, 'Failed to cache idempotency response');
          });

        return originalJson(body);
      };

      next();
    } catch (err) {
      // Fail open — process the request normally
      logger.error({ err }, 'Idempotency middleware error — failing open');
      next();
    }
  };
}
