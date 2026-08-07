import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextFunction, Request, Response } from 'express';
import { idempotency } from '../src/middleware/idempotency.middleware';

const mocks = vi.hoisted(() => {
  const prismaMock = {
    idempotencyRecord: {
      findUnique: vi.fn(),
      delete: vi.fn(),
      create: vi.fn(),
    },
  };

  return {
    prismaMock,
    loggerMock: {
      debug: vi.fn(),
      error: vi.fn(),
    },
  };
});

vi.mock('../src/db/client', () => ({ default: mocks.prismaMock }));
vi.mock('../src/utils/logger', () => ({ logger: mocks.loggerMock }));

function createRes() {
  const res = {
    statusCode: 201,
    status: vi.fn(() => res as unknown as Response),
    json: vi.fn((body: unknown) => body),
  };

  return res as unknown as Response;
}

describe('idempotency middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.prismaMock.idempotencyRecord.findUnique.mockResolvedValue(null);
    mocks.prismaMock.idempotencyRecord.create.mockResolvedValue({ id: 'record-1' });
  });

  it('passes through when idempotency header is missing', async () => {
    const middleware = idempotency();
    const req = {
      headers: {},
      method: 'POST',
      path: '/api/v1/tokens/mint',
    } as unknown as Request;
    const res = createRes();
    const next = vi.fn() as unknown as NextFunction;

    await middleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(mocks.prismaMock.idempotencyRecord.findUnique).not.toHaveBeenCalled();
  });

  it('returns cached response when non-expired record exists', async () => {
    const middleware = idempotency();
    const req = {
      headers: { 'idempotency-key': 'idem-1' },
      method: 'POST',
      path: '/api/v1/tokens/mint',
    } as unknown as Request;

    const res = {
      status: vi.fn(() => res),
      json: vi.fn(),
      statusCode: 200,
    } as unknown as Response;

    const next = vi.fn() as unknown as NextFunction;

    mocks.prismaMock.idempotencyRecord.findUnique.mockResolvedValue({
      key: 'POST:/api/v1/tokens/mint:idem-1',
      responseCode: 202,
      responseBody: { ok: true },
      expiresAt: new Date(Date.now() + 3600_000),
    });

    await middleware(req, res, next);

    expect((res.status as unknown as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(202);
    expect((res.json as unknown as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith({ ok: true });
    expect(next).not.toHaveBeenCalled();
  });

  it('deletes expired record and caches new response body', async () => {
    const middleware = idempotency();
    const req = {
      headers: { 'idempotency-key': 'idem-2' },
      method: 'POST',
      path: '/api/v1/tokens/mint',
    } as unknown as Request;

    const res = createRes();
    const next = vi.fn() as unknown as NextFunction;

    mocks.prismaMock.idempotencyRecord.findUnique.mockResolvedValue({
      key: 'POST:/api/v1/tokens/mint:idem-2',
      responseCode: 200,
      responseBody: { stale: true },
      expiresAt: new Date(Date.now() - 1000),
    });

    await middleware(req, res, next);

    expect(mocks.prismaMock.idempotencyRecord.delete).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledTimes(1);

    (res.json as unknown as ReturnType<typeof vi.fn>)({ ok: true, id: 'token-1' });

    expect(mocks.prismaMock.idempotencyRecord.create).toHaveBeenCalledTimes(1);
    const payload = mocks.prismaMock.idempotencyRecord.create.mock.calls[0]?.[0];
    expect(payload.data.responseCode).toBe(201);
    expect(payload.data.responseBody).toEqual({ ok: true, id: 'token-1' });
  });

  it('fails open on middleware exception', async () => {
    const middleware = idempotency();
    const req = {
      headers: { 'idempotency-key': 'idem-3' },
      method: 'POST',
      path: '/api/v1/tokens/mint',
    } as unknown as Request;
    const res = createRes();
    const next = vi.fn() as unknown as NextFunction;

    mocks.prismaMock.idempotencyRecord.findUnique.mockRejectedValue(new Error('db down'));

    await middleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
  });
});

describe('idempotency key scoping and failure caching', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.prismaMock.idempotencyRecord.findUnique.mockResolvedValue(null);
    mocks.prismaMock.idempotencyRecord.create.mockResolvedValue({ id: 'record-1' });
  });

  function runFor(req: Partial<Request>, res: Response) {
    const next = vi.fn() as unknown as NextFunction;
    return idempotency()(req as Request, res, next);
  }

  it('scopes the lookup key by tenant so two merchants cannot collide', async () => {
    await runFor({
      method: 'POST', path: '/mint', headers: { 'idempotency-key': 'shared' },
      merchantId: 'merchant-A',
    } as Partial<Request>, createRes());
    const keyA = mocks.prismaMock.idempotencyRecord.findUnique.mock.calls[0][0].where.key;

    vi.clearAllMocks();
    mocks.prismaMock.idempotencyRecord.findUnique.mockResolvedValue(null);

    await runFor({
      method: 'POST', path: '/mint', headers: { 'idempotency-key': 'shared' },
      merchantId: 'merchant-B',
    } as Partial<Request>, createRes());
    const keyB = mocks.prismaMock.idempotencyRecord.findUnique.mock.calls[0][0].where.key;

    expect(keyA).not.toBe(keyB);
    expect(keyA).toContain('merchant-A');
    expect(keyB).toContain('merchant-B');
  });

  it('does not cache a 4xx response', async () => {
    const res = createRes();
    (res as unknown as { statusCode: number }).statusCode = 400;
    await runFor({
      method: 'POST', path: '/mint', headers: { 'idempotency-key': 'k-400' },
      merchantId: 'merchant-A',
    } as Partial<Request>, res);

    res.json({ error: { code: 'validation_error' } });
    expect(mocks.prismaMock.idempotencyRecord.create).not.toHaveBeenCalled();
  });

  it('caches a 2xx response', async () => {
    const res = createRes();
    (res as unknown as { statusCode: number }).statusCode = 200;
    await runFor({
      method: 'POST', path: '/mint', headers: { 'idempotency-key': 'k-200' },
      merchantId: 'merchant-A',
    } as Partial<Request>, res);

    res.json({ ok: true });
    expect(mocks.prismaMock.idempotencyRecord.create).toHaveBeenCalledTimes(1);
  });
});
