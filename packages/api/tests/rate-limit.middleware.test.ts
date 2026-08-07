import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextFunction, Request, Response } from 'express';
import { rateLimit } from '../src/middleware/rate-limit.middleware';
import { RATE_LIMITS } from '@tokento/shared';

const mocks = vi.hoisted(() => {
  const execMock = vi.fn();
  const pipelineMock = {
    zremrangebyscore: vi.fn(),
    zadd: vi.fn(),
    zcard: vi.fn(),
    pexpire: vi.fn(),
    exec: execMock,
  };

  return {
    execMock,
    pipelineMock,
    redisMock: {
      pipeline: vi.fn(() => pipelineMock),
    },
  };
});

vi.mock('../src/db/redis', () => ({ default: mocks.redisMock }));
vi.mock('../src/utils/logger', () => ({
  logger: {
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

function createRes() {
  const res = {
    statusCode: 200,
    headers: {} as Record<string, string | number>,
    setHeader: vi.fn((k: string, v: string | number) => {
      res.headers[k] = v;
    }),
    status: vi.fn((code: number) => {
      res.statusCode = code;
      return res as unknown as Response;
    }),
    json: vi.fn(),
  };
  return res as unknown as Response;
}

describe('rateLimit middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.execMock.mockResolvedValue([[null, 0], [null, 1], [null, 1], [null, 1]]);
  });

  it('sets headers and calls next below limit', async () => {
    const middleware = rateLimit('QUERY');
    const req = {
      merchantId: 'merchant-1',
      ip: '127.0.0.1',
      requestId: 'req-1',
    } as unknown as Request;
    const res = createRes();
    const next = vi.fn() as unknown as NextFunction;

    await middleware(req, res, next);

    expect(mocks.redisMock.pipeline).toHaveBeenCalledTimes(1);
    expect((res.setHeader as unknown as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith('X-RateLimit-Limit', 100);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('returns 429 when count exceeds limit', async () => {
    const middleware = rateLimit('REDEEM');
    const req = {
      ip: '127.0.0.1',
      requestId: 'req-over-limit',
    } as unknown as Request;
    const res = createRes();
    const next = vi.fn() as unknown as NextFunction;

    mocks.execMock.mockResolvedValue([[null, 0], [null, 1], [null, 11], [null, 1]]);

    await middleware(req, res, next);

    expect((res.status as unknown as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(429);
    expect((res.json as unknown as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(1);
    expect(next).not.toHaveBeenCalled();
  });

  it('fails open when redis pipeline returns null', async () => {
    const middleware = rateLimit('DEFAULT');
    const req = {
      ip: '127.0.0.1',
      requestId: 'req-no-redis',
    } as unknown as Request;
    const res = createRes();
    const next = vi.fn() as unknown as NextFunction;

    mocks.execMock.mockResolvedValue(null);

    await middleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  it('fails open on exceptions', async () => {
    const middleware = rateLimit('DEFAULT');
    const req = {
      ip: '127.0.0.1',
      requestId: 'req-error',
    } as unknown as Request;
    const res = createRes();
    const next = vi.fn() as unknown as NextFunction;

    mocks.execMock.mockRejectedValue(new Error('redis down'));

    await middleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
  });
});

describe('rate limit boundary and failure mode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  async function runWithCount(count: number, tier: 'REDEEM' | 'QUERY') {
    mocks.execMock.mockResolvedValue([[null, 0], [null, 1], [null, count], [null, 1]]);
    const res = createRes();
    const next = vi.fn() as unknown as NextFunction;
    await rateLimit(tier)({ customerId: 'cust-1', requestId: 'r' } as unknown as Request, res, next);
    return { res, next };
  }

  async function runWithRedisDown(tier: 'REDEEM' | 'QUERY') {
    mocks.execMock.mockRejectedValue(new Error('redis down'));
    const res = createRes();
    const next = vi.fn() as unknown as NextFunction;
    await rateLimit(tier)({ customerId: 'cust-1', requestId: 'r' } as unknown as Request, res, next);
    return { res, next };
  }

  it('admits exactly `limit` requests and blocks the next one', async () => {
    const limit = RATE_LIMITS.REDEEM;
    // zadd precedes zcard, so the Nth request in the window observes count === N.
    const atLimit = await runWithCount(limit, 'REDEEM');
    expect(atLimit.next).toHaveBeenCalledTimes(1);

    const overLimit = await runWithCount(limit + 1, 'REDEEM');
    expect(overLimit.res.status).toHaveBeenCalledWith(429);
    expect(overLimit.next).not.toHaveBeenCalled();
  });

  it('fails CLOSED with 503 on redeem when Redis is unavailable', async () => {
    const { res, next } = await runWithRedisDown('REDEEM');
    expect(res.status).toHaveBeenCalledWith(503);
    expect(next).not.toHaveBeenCalled();
  });

  it('fails OPEN on a read when Redis is unavailable', async () => {
    const { res, next } = await runWithRedisDown('QUERY');
    expect(res.status).not.toHaveBeenCalledWith(503);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('keys on the authenticated customer rather than the shared IP', async () => {
    mocks.execMock.mockResolvedValue([[null, 0], [null, 1], [null, 1], [null, 1]]);
    const next = vi.fn() as unknown as NextFunction;
    await rateLimit('QUERY')(
      { customerId: 'cust-9', ip: '10.0.0.1', requestId: 'r' } as unknown as Request,
      createRes(), next,
    );
    const key = mocks.pipelineMock.zcard.mock.calls[0][0];
    expect(key).toContain('cust-9');
    expect(key).not.toContain('10.0.0.1');
  });
});
