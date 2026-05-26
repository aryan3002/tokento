// ============================================================
// Tokento — Error Middleware
// ============================================================
// Standardized error responses with reason codes.

import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { logger } from '../utils/logger';

export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly details?: Record<string, unknown>;

  constructor(
    statusCode: number,
    code: string,
    message: string,
    details?: Record<string, unknown>
  ) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    this.name = 'AppError';
  }
}

/**
 * Global error handler middleware.
 */
export function errorHandler() {
  return (err: Error, req: Request, res: Response, _next: NextFunction): void => {
    // Zod validation errors
    if (err instanceof ZodError) {
      res.status(400).json({
        error: {
          code: 'validation_error',
          message: 'Request validation failed.',
          details: {
            issues: err.issues.map((issue) => ({
              path: issue.path.join('.'),
              message: issue.message,
              code: issue.code,
            })),
          },
        },
        requestId: req.requestId || 'unknown',
      });
      return;
    }

    // Application errors
    if (err instanceof AppError) {
      res.status(err.statusCode).json({
        error: {
          code: err.code,
          message: err.message,
          details: err.details,
        },
        requestId: req.requestId || 'unknown',
      });
      return;
    }

    // Unknown errors
    logger.error({ err, path: req.path, method: req.method }, 'Unhandled error');

    res.status(500).json({
      error: {
        code: 'internal_error',
        message: 'An unexpected error occurred.',
      },
      requestId: req.requestId || 'unknown',
    });
  };
}

/**
 * 404 handler for unmatched routes.
 */
export function notFoundHandler() {
  return (req: Request, res: Response): void => {
    res.status(404).json({
      error: {
        code: 'not_found',
        message: `Route ${req.method} ${req.path} not found.`,
      },
      requestId: req.requestId || 'unknown',
    });
  };
}
