import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextFunction, Request, Response } from 'express';
import { auditLog } from '../src/middleware/audit.middleware';

const mocks = vi.hoisted(() => {
  const prismaMock = {
    auditLog: {
      create: vi.fn(),
    },
  };

  return {
    prismaMock,
    loggerMock: {
      error: vi.fn(),
    },
  };
});

vi.mock('../src/db/client', () => ({ default: mocks.prismaMock }));
vi.mock('../src/utils/logger', () => ({ logger: mocks.loggerMock }));

describe('audit middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.prismaMock.auditLog.create.mockResolvedValue({ id: 'audit-1' });
  });

  it('writes sanitized audit records when response ends', () => {
    const middleware = auditLog();
    const req = {
      method: 'POST',
      path: '/api/v1/tokens/token-123/redeem',
      merchantId: 'merchant-1',
      customerId: 'customer-1',
      body: {
        apiKey: 'super-secret',
        amount: 10,
      },
      ip: '127.0.0.1',
      headers: { 'user-agent': 'vitest' },
    } as unknown as Request;

    const res = {
      statusCode: 200,
      json: vi.fn((body: unknown) => body),
      end: vi.fn(() => res as unknown as Response),
    } as unknown as Response;

    const next = vi.fn() as unknown as NextFunction;

    middleware(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);

    (res.end as unknown as ReturnType<typeof vi.fn>)();

    expect(mocks.prismaMock.auditLog.create).toHaveBeenCalledTimes(1);
    const payload = mocks.prismaMock.auditLog.create.mock.calls[0]?.[0];
    expect(payload.data.method).toBe('POST');
    expect(payload.data.endpoint).toBe('/api/v1/tokens/token-123/redeem');
    expect(payload.data.requestBody.apiKey).toBe('[REDACTED]');
    expect(payload.data.requestBody.amount).toBe(10);
  });

  it('logs write failures without breaking response', async () => {
    const middleware = auditLog();
    const req = {
      method: 'GET',
      path: '/api/v1/tokens',
      headers: {},
      body: {},
    } as unknown as Request;

    const res = {
      statusCode: 200,
      json: vi.fn((body: unknown) => body),
      end: vi.fn(() => res as unknown as Response),
    } as unknown as Response;

    const next = vi.fn() as unknown as NextFunction;

    mocks.prismaMock.auditLog.create.mockRejectedValueOnce(new Error('audit write failed'));

    middleware(req, res, next);
    (res.end as unknown as ReturnType<typeof vi.fn>)();

    await Promise.resolve();
    expect(mocks.loggerMock.error).toHaveBeenCalledTimes(1);
  });
});
