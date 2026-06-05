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
import { authenticateB2BSessionJwt, authenticateB2CSessionJwt } from '../services/stytch.service';

// Extend Express Request to carry auth context
declare global {
  namespace Express {
    interface Request {
      merchantId?: string;
      customerId?: string;
      apiKeyScopes?: string[];
      isSandbox?: boolean;
      b2bMemberId?: string;
      b2bOrganizationId?: string;
      stytchUserId?: string;
      requestId?: string;
    }
  }
}

function extractBearerToken(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  return authHeader.substring(7);
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
      }).catch((err: unknown) => {
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
      const sessionJwt = extractBearerToken(req);
      if (!sessionJwt) {
        res.status(401).json({
          error: {
            code: 'missing_bearer_token',
            message: 'B2C session JWT required.',
          },
          requestId: req.requestId || 'unknown',
        });
        return;
      }

      try {
        const auth = await authenticateB2CSessionJwt(sessionJwt);
        req.customerId = auth.customerId;
        req.stytchUserId = auth.userId;
        next();
      } catch (err) {
        logger.warn({ err }, 'B2C bearer token authentication failed');
        res.status(401).json({
          error: {
            code: 'invalid_bearer_token',
            message: 'Invalid B2C session JWT.',
          },
          requestId: req.requestId || 'unknown',
        });
        return;
      }
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

/**
 * Middleware: Authenticate dashboard/merchant context via B2B session JWT.
 */
export function authenticateB2BSession() {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const sessionJwt = extractBearerToken(req);
      if (!sessionJwt) {
        res.status(401).json({
          error: {
            code: 'missing_b2b_session',
            message: 'B2B session JWT required in Authorization: Bearer <jwt>.',
          },
          requestId: req.requestId || 'unknown',
        });
        return;
      }

      try {
        const auth = await authenticateB2BSessionJwt(sessionJwt);
        req.merchantId = auth.merchantId;
        req.b2bMemberId = auth.memberId;
        req.b2bOrganizationId = auth.organizationId;
        req.isSandbox = true;
        next();
      } catch (err) {
        logger.warn({ err }, 'B2B session authentication failed');
        res.status(401).json({
          error: {
            code: 'invalid_b2b_session',
            message: 'Invalid B2B session JWT.',
          },
          requestId: req.requestId || 'unknown',
        });
      }
    } catch (err) {
      logger.error({ err }, 'B2B auth middleware error');
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
 * Middleware: authenticate merchant context via API key (preferred for S2S)
 * or via B2B session JWT (dashboard flow).
 */
export function authenticateApiKeyOrB2BSession(requiredScopes: string[] = []) {
  const apiKeyMiddleware = authenticateApiKey(requiredScopes);
  const b2bMiddleware = authenticateB2BSession();

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const hasApiKey = Boolean(req.headers[API_KEY.HEADER_NAME.toLowerCase()]);
    if (hasApiKey) {
      return apiKeyMiddleware(req, res, next);
    }
    return b2bMiddleware(req, res, next);
  };
}
