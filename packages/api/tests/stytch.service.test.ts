import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  prismaMock: {
    merchant: {
      findFirst: vi.fn(async () => ({ id: '11111111-1111-4111-8111-111111111111' })),
    },
  },
}));

vi.mock('../src/db/client', () => ({
  default: mocks.prismaMock,
}));

import {
  authenticateB2BSessionJwt,
  authenticateB2CSessionJwt,
  createDevB2BSessionJwt,
  createDevB2CSessionJwt,
} from '../src/services/stytch.service';

describe('stytch service dev fallback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('authenticates B2B dev session JWT format locally', async () => {
    const result = await authenticateB2BSessionJwt('b2b_dev_session::merchant-123');
    expect(result.fallback).toBe(true);
    expect(result.merchantId).toBe('merchant-123');
    expect(result.memberId).toContain('dev-member');
  });

  it('authenticates B2C dev session JWT format locally', async () => {
    const result = await authenticateB2CSessionJwt('b2c_dev_session::customer-456');
    expect(result.fallback).toBe(true);
    expect(result.customerId).toBe('customer-456');
    expect(result.userId).toContain('dev-user');
  });

  it('creates dev B2B session when merchant id is omitted', async () => {
    const session = await createDevB2BSessionJwt();
    expect(session.merchantId).toBe('11111111-1111-4111-8111-111111111111');
    expect(session.sessionJwt).toContain(session.merchantId);
    expect(mocks.prismaMock.merchant.findFirst).toHaveBeenCalledTimes(1);
  });

  it('creates dev B2C session for widget oauth handoff', async () => {
    const session = await createDevB2CSessionJwt('customer-789');
    expect(session.customerId).toBe('customer-789');
    expect(session.sessionJwt).toBe('b2c_dev_session::customer-789');
  });
});
