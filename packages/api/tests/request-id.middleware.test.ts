import { describe, expect, it, vi } from 'vitest';
import type { NextFunction, Request, Response } from 'express';
import { requestId } from '../src/middleware/request-id.middleware';

const uuidV4Mock = vi.hoisted(() => vi.fn(() => 'generated-request-id'));
vi.mock('uuid', () => ({ v4: uuidV4Mock }));

function createRes() {
  return {
    setHeader: vi.fn(),
  } as unknown as Response;
}

describe('requestId middleware', () => {
  it('uses incoming x-request-id when present', () => {
    const middleware = requestId();
    const req = {
      headers: { 'x-request-id': 'incoming-id' },
    } as unknown as Request;
    const res = createRes();
    const next = vi.fn() as unknown as NextFunction;

    middleware(req, res, next);

    expect(req.requestId).toBe('incoming-id');
    expect((res.setHeader as unknown as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith('X-Request-Id', 'incoming-id');
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('generates request id when header is absent', () => {
    const middleware = requestId();
    const req = {
      headers: {},
    } as unknown as Request;
    const res = createRes();
    const next = vi.fn() as unknown as NextFunction;

    middleware(req, res, next);

    expect(uuidV4Mock).toHaveBeenCalledTimes(1);
    expect(req.requestId).toBe('generated-request-id');
    expect((res.setHeader as unknown as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith('X-Request-Id', 'generated-request-id');
    expect(next).toHaveBeenCalledTimes(1);
  });
});
