// ============================================================
// Tokento — Audit Middleware
// ============================================================
// Logs every API call with timestamp, caller identity, params, response code.
// 100% coverage, queryable by merchant_id/customer_id/token_id/date_range.
// 90-day retention minimum.

import { Request, Response, NextFunction } from 'express';
import prisma from '../db/client';
import { logger } from '../utils/logger';

/**
 * Audit logging middleware — logs every request/response.
 * Writes asynchronously to avoid blocking the response path (Revision #9).
 */
export function auditLog() {
  return (req: Request, res: Response, next: NextFunction): void => {
    const startTime = Date.now();

    // Capture the original end method
    const originalEnd = res.end;
    const originalJson = res.json;

    let responseBody: unknown = null;

    // Override res.json to capture response
    res.json = function (body: unknown) {
      responseBody = body;
      return originalJson.call(this, body);
    };

    // Override res.end to log after response
    res.end = function (this: Response, ...args: unknown[]) {
      const responseTimeMs = Date.now() - startTime;

      // Extract token ID from URL if present
      const tokenIdMatch = req.path.match(/\/tokens\/([a-f0-9-]+)/);
      const tokenId = tokenIdMatch ? tokenIdMatch[1] : null;

      // Write audit log asynchronously (don't block response)
      prisma.auditLog
        .create({
          data: {
            method: req.method,
            endpoint: req.path,
            merchantId: req.merchantId || null,
            customerId: req.customerId || null,
            tokenId,
            requestBody: req.body && Object.keys(req.body).length > 0
              ? sanitizeBody(req.body)
              : null,
            responseCode: res.statusCode,
            responseTimeMs,
            ipAddress: req.ip || null,
            userAgent: req.headers['user-agent'] || null,
          },
        })
        .catch((err) => {
          logger.error({ err }, 'Failed to write audit log');
        });

      // Apply original end
      return originalEnd.apply(this, args as Parameters<typeof originalEnd>);
    };

    next();
  };
}

/**
 * Sanitize request body for audit logging.
 * Remove sensitive fields like API keys, passwords, etc.
 */
function sanitizeBody(body: Record<string, unknown>): Record<string, unknown> {
  const sensitiveFields = ['apiKey', 'password', 'secret', 'token', 'key'];
  const sanitized = { ...body };

  for (const field of sensitiveFields) {
    if (field in sanitized) {
      sanitized[field] = '[REDACTED]';
    }
  }

  return sanitized;
}
