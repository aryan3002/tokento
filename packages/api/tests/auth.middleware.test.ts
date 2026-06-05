import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextFunction, Request, Response } from 'express';
import { authenticateApiKey, authenticateApiKeyOrB2BSession, authenticateB2BSession, authenticateBearerToken } from '../src/middleware/auth.middleware';

const mocks = vi.hoisted(() => {
  const prismaMock = {
    apiKey: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  };

  return {
    prismaMock,
    hashApiKeyMock: vi.fn(() => 'hashed-key'),
    authB2BMock: vi.fn(),
    authB2CMock: vi.fn(),
    loggerMock: {
      warn: vi.fn(),
      error: vi.fn(),
    },
  };
});

vi.mock('../src/db/client', () => ({ default: mocks.prismaMock }));
vi.mock('../src/utils/ids', () => ({ hashApiKey: mocks.hashApiKeyMock }));
vi.mock('../src/services/stytch.service', () => ({
  authenticateB2BSessionJwt: mocks.authB2BMock,
  authenticateB2CSessionJwt: mocks.authB2CMock,
}));
vi.mock('../src/utils/logger', () => ({ logger: mocks.loggerMock }));

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

describe('auth middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.prismaMock.apiKey.update.mockResolvedValue({ id: 'key-1' });
    mocks.prismaMock.apiKey.findUnique.mockResolvedValue({
      id: 'key-1',
      merchantId: 'merchant-1',
      scopes: ['token:mint', 'merchant:read'],
      isSandbox: true,
      isActive: true,
      expiresAt: null,
    });
  });

  it('authenticateApiKey returns 401 when key missing', async () => {
    const middleware = authenticateApiKey();
    const req = { headers: {}, requestId: 'req-1' } as unknown as Request;
    const res = createRes();
    const next = vi.fn() as unknown as NextFunction;

    await middleware(req, res, next);

    expect((res.status as unknown as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('authenticateApiKey rejects invalid key', async () => {
    const middleware = authenticateApiKey();
    const req = { headers: { 'x-api-key': 'bad' }, requestId: 'req-2' } as unknown as Request;
    const res = createRes();
    const next = vi.fn() as unknown as NextFunction;

    mocks.prismaMock.apiKey.findUnique.mockResolvedValueOnce(null);

    await middleware(req, res, next);

    expect((res.status as unknown as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('authenticateApiKey enforces expiry and scopes', async () => {
    const req = { headers: { 'x-api-key': 'tk' }, requestId: 'req-3' } as unknown as Request;
    const res = createRes();
    const next = vi.fn() as unknown as NextFunction;

    const middleware = authenticateApiKey(['token:redeem']);

    mocks.prismaMock.apiKey.findUnique.mockResolvedValueOnce({
      id: 'key-expired',
      merchantId: 'merchant-1',
      scopes: ['token:redeem'],
      isSandbox: true,
      isActive: true,
      expiresAt: new Date(Date.now() - 1000),
    });

    await middleware(req, res, next);
    expect((res.status as unknown as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(401);

    mocks.prismaMock.apiKey.findUnique.mockResolvedValueOnce({
      id: 'key-scope',
      merchantId: 'merchant-1',
      scopes: ['merchant:read'],
      isSandbox: true,
      isActive: true,
      expiresAt: null,
    });

    await middleware(req, res, next);
    expect((res.status as unknown as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(403);
  });

  it('authenticateApiKey sets auth context on success', async () => {
    const middleware = authenticateApiKey(['token:mint']);
    const req = { headers: { 'x-api-key': 'tk_ok' }, requestId: 'req-4' } as unknown as Request;
    const res = createRes();
    const next = vi.fn() as unknown as NextFunction;

    await middleware(req, res, next);

    expect(req.merchantId).toBe('merchant-1');
    expect(req.isSandbox).toBe(true);
    expect(next).toHaveBeenCalledTimes(1);
    expect(mocks.prismaMock.apiKey.update).toHaveBeenCalledTimes(1);
  });

  it('authenticateBearerToken handles missing, invalid, and success', async () => {
    const middleware = authenticateBearerToken();
    const res = createRes();
    const next = vi.fn() as unknown as NextFunction;

    const missingReq = { headers: {}, requestId: 'req-5' } as unknown as Request;
    await middleware(missingReq, res, next);
    expect((res.status as unknown as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(401);

    const invalidReq = {
      headers: { authorization: 'Bearer invalid' },
      requestId: 'req-6',
    } as unknown as Request;
    mocks.authB2CMock.mockRejectedValueOnce(new Error('bad jwt'));
    await middleware(invalidReq, res, next);
    expect((res.status as unknown as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(401);

    const validReq = {
      headers: { authorization: 'Bearer valid' },
      requestId: 'req-7',
    } as unknown as Request;
    mocks.authB2CMock.mockResolvedValueOnce({ customerId: 'customer-1', userId: 'user-1' });
    await middleware(validReq, res, next);
    expect(validReq.customerId).toBe('customer-1');
    expect(next).toHaveBeenCalled();
  });

  it('authenticateB2BSession handles missing, invalid, and success', async () => {
    const middleware = authenticateB2BSession();
    const res = createRes();
    const next = vi.fn() as unknown as NextFunction;

    const missingReq = { headers: {}, requestId: 'req-8' } as unknown as Request;
    await middleware(missingReq, res, next);
    expect((res.status as unknown as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(401);

    const invalidReq = {
      headers: { authorization: 'Bearer invalid-b2b' },
      requestId: 'req-9',
    } as unknown as Request;
    mocks.authB2BMock.mockRejectedValueOnce(new Error('bad b2b'));
    await middleware(invalidReq, res, next);
    expect((res.status as unknown as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(401);

    const validReq = {
      headers: { authorization: 'Bearer valid-b2b' },
      requestId: 'req-10',
    } as unknown as Request;
    mocks.authB2BMock.mockResolvedValueOnce({
      merchantId: 'merchant-2',
      memberId: 'member-2',
      organizationId: 'org-2',
    });
    await middleware(validReq, res, next);
    expect(validReq.merchantId).toBe('merchant-2');
    expect(validReq.b2bMemberId).toBe('member-2');
    expect(next).toHaveBeenCalled();
  });

  it('authenticateApiKeyOrB2BSession routes by header', async () => {
    const middleware = authenticateApiKeyOrB2BSession(['token:mint']);
    const res = createRes();
    const next = vi.fn() as unknown as NextFunction;

    const apiKeyReq = {
      headers: { 'x-api-key': 'api-key-path' },
      requestId: 'req-11',
    } as unknown as Request;
    await middleware(apiKeyReq, res, next);
    expect(mocks.hashApiKeyMock).toHaveBeenCalled();

    const b2bReq = {
      headers: { authorization: 'Bearer b2b-jwt' },
      requestId: 'req-12',
    } as unknown as Request;
    mocks.authB2BMock.mockResolvedValueOnce({ merchantId: 'merchant-3', memberId: 'member-3', organizationId: 'org-3' });
    await middleware(b2bReq, res, next);
    expect(b2bReq.merchantId).toBe('merchant-3');
  });
});
