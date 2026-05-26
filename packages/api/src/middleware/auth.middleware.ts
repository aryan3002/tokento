// ============================================================
// Tokento — Auth Middleware
// ============================================================
// Validates merchant API key or OAuth 2.0 bearer token.
// Stytch integration placeholder (Revision #2 — Stytch from Day 1).

import { Request, Response, NextFunction } from 'express';
import { API_KEY } from '@tokento/shared';
import { hashApiKey } from '../utils/ids';
import prisma from '../db/client';
import { logger } from '../utils/logger';

// Extend Express Request to carry auth context
declare global {
  namespace Express {
    interface Request {
      merchantId?: string;
      customerId?: string;
      apiKeyScopes?: string[];
      isSandbox?: boolean;
      requestId?: string;
    }
  }
}

/**
 * Middleware: Authenticate via merchant API key.
 * Key is passed in the X-API-Key header.
 */
export function authenticateApiKey(requiredScopes: string[] = []) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const rawKey = req.headers[API_KEY.HEADER_NAME.toLowerCase()] as string;

      if (!rawKey) {
        res.status(401).json({
          error: {
            code: 'missing_api_key',
            message: `API key required. Pass it in the ${API_KEY.HEADER_NAME} header.`,
          },
          requestId: req.requestId || 'unknown',
        });
        return;
      }

      const keyHash = hashApiKey(rawKey);
      const apiKey = await prisma.apiKey.findUnique({
        where: { keyHash },
      });

      if (!apiKey || !apiKey.isActive) {
        res.status(401).json({
          error: {
            code: 'invalid_api_key',
            message: 'Invalid or deactivated API key.',
          },
          requestId: req.requestId || 'unknown',
        });
        return;
      }

      // Check expiry
      if (apiKey.expiresAt && new Date() > apiKey.expiresAt) {
        res.status(401).json({
          error: {
            code: 'expired_api_key',
            message: 'API key has expired.',
          },
          requestId: req.requestId || 'unknown',
        });
        return;
      }

      // Check scopes
      if (requiredScopes.length > 0) {
        const hasAllScopes = requiredScopes.every((scope) =>
          apiKey.scopes.includes(scope)
        );
        if (!hasAllScopes) {
          res.status(403).json({
            error: {
              code: 'insufficient_scopes',
              message: `This API key lacks required scopes: ${requiredScopes.join(', ')}`,
            },
            requestId: req.requestId || 'unknown',
          });
          return;
        }
      }

      // Attach auth context to request
      req.merchantId = apiKey.merchantId;
      req.apiKeyScopes = apiKey.scopes;
      req.isSandbox = apiKey.isSandbox;

      // Update last used (fire and forget)
      prisma.apiKey.update({
        where: { id: apiKey.id },
        data: { lastUsedAt: new Date() },
      }).catch((err) => {
        logger.warn({ err }, 'Failed to update API key lastUsedAt');
      });

      next();
    } catch (err) {
      logger.error({ err }, 'Auth middleware error');
      res.status(500).json({
        error: {
          code: 'auth_error',
          message: 'Authentication failed due to an internal error.',
        },
        requestId: req.requestId || 'unknown',
      });
    }
  };
}

/**
 * Middleware: Authenticate via OAuth 2.0 bearer token (for wallet/agent access).
 * MVP: simplified JWT validation. Stytch integration in Phase 2.
 */
export function authenticateBearerToken() {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const authHeader = req.headers.authorization;

      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        res.status(401).json({
          error: {
            code: 'missing_bearer_token',
            message: 'OAuth 2.0 bearer token required.',
          },
          requestId: req.requestId || 'unknown',
        });
        return;
      }

      // MVP: Simple token validation
      // TODO: Replace with Stytch OAuth session validation
      const token = authHeader.substring(7);

      // For MVP, we use a simple approach: the token IS the customer ID
      // In production, this would validate against Stytch and extract the customer ID
      if (!token || token.length < 8) {
        res.status(401).json({
          error: {
            code: 'invalid_bearer_token',
            message: 'Invalid bearer token.',
          },
          requestId: req.requestId || 'unknown',
        });
        return;
      }

      req.customerId = token;
      next();
    } catch (err) {
      logger.error({ err }, 'Bearer auth middleware error');
      res.status(500).json({
        error: {
          code: 'auth_error',
          message: 'Authentication failed due to an internal error.',
        },
        requestId: req.requestId || 'unknown',
      });
    }
  };
}
