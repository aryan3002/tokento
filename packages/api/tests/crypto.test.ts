import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('HMAC master key handling', () => {
  const OLD_ENV = process.env;

  beforeEach(() => { vi.resetModules(); process.env = { ...OLD_ENV }; });
  afterEach(() => { process.env = OLD_ENV; });

  it('refuses to load without HMAC_MASTER_KEY in production', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.HMAC_MASTER_KEY;
    await expect(import('../src/utils/crypto')).rejects.toThrow(/HMAC_MASTER_KEY/);
  });

  it('allows a development fallback key outside production', async () => {
    process.env.NODE_ENV = 'development';
    delete process.env.HMAC_MASTER_KEY;
    const crypto = await import('../src/utils/crypto');
    expect(typeof crypto.signToken).toBe('function');
  });
});

describe('token signature covers tamper-sensitive fields', () => {
  const base = {
    tokenId: 'tok-1',
    merchantId: 'merch-1',
    customerId: 'cust-1',
    denomination: 5,
    expiryAt: '2027-01-01T00:00:00.000Z',
    isSandbox: true,
    minimumTransactionFloor: 10,
    agentPresentableFlag: true,
  };

  it('rejects a lowered minimumTransactionFloor', async () => {
    const { signToken, verifyTokenSignature } = await import('../src/utils/crypto');
    const signature = signToken(base);
    expect(verifyTokenSignature({ ...base, signature })).toBe(true);
    expect(verifyTokenSignature({ ...base, minimumTransactionFloor: 0, signature })).toBe(false);
  });

  it('rejects a flipped agentPresentableFlag', async () => {
    const { signToken, verifyTokenSignature } = await import('../src/utils/crypto');
    const signature = signToken(base);
    expect(verifyTokenSignature({ ...base, agentPresentableFlag: false, signature })).toBe(false);
  });
});
