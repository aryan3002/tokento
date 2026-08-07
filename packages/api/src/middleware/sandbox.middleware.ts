// ============================================================
// Tokento — Sandbox Isolation
// ============================================================
// Sandbox and production data must never mix. Same API surface, same behavior,
// no real value settlement in sandbox.
//
// The sandbox context is established during AUTHENTICATION, not by a global
// middleware: an API key carries its own `isSandbox`, and a customer session is
// scoped to the deployment. A previous version registered a global middleware
// ahead of auth, where `req.isSandbox` was always undefined and the default was
// applied unconditionally — making it a no-op that produced false confidence.

import { Request } from 'express';
import { AppError } from './error.middleware';

/**
 * The deployment-level sandbox flag, used for principals that do not carry their
 * own sandbox context (customer sessions).
 */
export function deploymentIsSandbox(): boolean {
  return process.env.SANDBOX_MODE === 'true';
}

/**
 * Read the sandbox context established during authentication.
 *
 * Throws rather than defaulting: a missing value means a route was wired without
 * authentication, and silently guessing would let sandbox and production tokens
 * mix on a money path. Callers pass the result explicitly into services, whose
 * `isSandbox` parameters are required so the compiler catches omissions.
 */
export function requireSandboxContext(req: Request): boolean {
  if (typeof req.isSandbox !== 'boolean') {
    throw new AppError(
      500,
      'sandbox_unresolved',
      'Sandbox context was not established during authentication.',
    );
  }
  return req.isSandbox;
}
