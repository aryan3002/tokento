import { describe, expect, it, vi } from 'vitest';
import type { NextFunction, Request, Response } from 'express';
import { sandboxIsolation } from '../src/middleware/sandbox.middleware';

function runMiddleware(req: Partial<Request>): { req: Partial<Request>; next: ReturnType<typeof vi.fn> } {
  const middleware = sandboxIsolation();
  const next = vi.fn() as unknown as NextFunction;
  middleware(req as Request, {} as Response, next);
  return { req, next: next as unknown as ReturnType<typeof vi.fn> };
}

describe('sandbox isolation middleware', () => {
  it('defaults to SANDBOX_MODE when req.isSandbox is unset', () => {
    process.env.SANDBOX_MODE = 'true';
    const { req, next } = runMiddleware({});
    expect(req.isSandbox).toBe(true);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('preserves existing sandbox value from prior auth middleware', () => {
    process.env.SANDBOX_MODE = 'false';
    const { req, next } = runMiddleware({ isSandbox: true });
    expect(req.isSandbox).toBe(true);
    expect(next).toHaveBeenCalledTimes(1);
  });
});
