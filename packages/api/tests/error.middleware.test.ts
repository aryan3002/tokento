import { describe, expect, it, vi } from 'vitest';
import type { NextFunction, Request, Response } from 'express';
import { ZodError, z } from 'zod';
import { AppError, errorHandler, notFoundHandler } from '../src/middleware/error.middleware';

vi.mock('../src/utils/logger', () => ({
  logger: {
    error: vi.fn(),
  },
}));

function createRes() {
  const res = {
    statusCode: 200,
    status: vi.fn((code: number) => {
      res.statusCode = code;
      return res as unknown as Response;
    }),
    json: vi.fn(),
  };
  return res as unknown as Response;
}

describe('error middleware', () => {
  it('maps zod errors to validation_error', () => {
    const handler = errorHandler();
    const schema = z.object({ amount: z.number() });
    const parsed = schema.safeParse({ amount: '10' });
    const zodErr = parsed.success ? null : parsed.error;

    const req = { requestId: 'req-zod', method: 'POST', path: '/x' } as unknown as Request;
    const res = createRes();

    handler(zodErr as unknown as ZodError, req, res, vi.fn() as unknown as NextFunction);

    expect((res.status as unknown as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(400);
    expect((res.json as unknown as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(expect.objectContaining({
      error: expect.objectContaining({ code: 'validation_error' }),
      requestId: 'req-zod',
    }));
  });

  it('maps AppError directly', () => {
    const handler = errorHandler();
    const req = { requestId: 'req-app', method: 'GET', path: '/x' } as unknown as Request;
    const res = createRes();

    handler(new AppError(409, 'conflict', 'conflict happened'), req, res, vi.fn() as unknown as NextFunction);

    expect((res.status as unknown as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(409);
    expect((res.json as unknown as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(expect.objectContaining({
      error: expect.objectContaining({ code: 'conflict' }),
      requestId: 'req-app',
    }));
  });

  it('maps unknown errors to internal_error and captures in sentry', () => {
    const handler = errorHandler();
    const req = { requestId: 'req-unknown', method: 'GET', path: '/x' } as unknown as Request;
    const res = createRes();

    handler(new Error('boom'), req, res, vi.fn() as unknown as NextFunction);

    expect((res.status as unknown as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(500);
  });

  it('returns not_found payload from notFoundHandler', () => {
    const handler = notFoundHandler();
    const req = { requestId: 'req-404', method: 'GET', path: '/missing' } as unknown as Request;
    const res = createRes();

    handler(req, res);

    expect((res.status as unknown as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(404);
    expect((res.json as unknown as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(expect.objectContaining({
      error: expect.objectContaining({ code: 'not_found' }),
    }));
  });
});
