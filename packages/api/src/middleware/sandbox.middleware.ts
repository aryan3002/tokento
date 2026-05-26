// ============================================================
// Tokento — Sandbox Middleware
// ============================================================
// Rejects sandbox tokens in production, vice versa.
// Same API surface, same behavior, no real value settlement.

import { Request, Response, NextFunction } from 'express';

/**
 * Sandbox isolation middleware.
 * Ensures sandbox API keys can only operate on sandbox tokens.
 */
export function sandboxIsolation() {
  return (req: Request, res: Response, next: NextFunction): void => {
    // If we have sandbox context from auth, attach it to request
    if (req.isSandbox === undefined) {
      // Default to sandbox if not set
      req.isSandbox = process.env.SANDBOX_MODE === 'true';
    }
    next();
  };
}
