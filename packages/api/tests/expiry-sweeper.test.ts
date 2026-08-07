import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TokenStatus } from '@tokento/shared';

const mocks = vi.hoisted(() => ({
  prismaMock: {
    token: { findMany: vi.fn(), updateMany: vi.fn() },
  },
  redisMock: { set: vi.fn(), keys: vi.fn(async () => []), del: vi.fn(async () => 0) },
  emitEventMock: vi.fn(),
  loggerMock: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../src/db/client', () => ({ default: mocks.prismaMock }));
vi.mock('../src/db/redis', () => ({ default: mocks.redisMock }));
vi.mock('../src/events/emitter', () => ({ emitEvent: mocks.emitEventMock }));
vi.mock('../src/utils/logger', () => ({ logger: mocks.loggerMock }));

import { sweepExpiredTokens } from '../src/jobs/expiry-sweeper';

const expiredToken = {
  id: 'tok-expired', merchantId: 'm-1', customerId: 'c-1',
  denomination: 5, expiryAt: new Date('2020-01-01'), isSandbox: true,
};

describe('expiry sweeper', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.redisMock.set.mockResolvedValue('OK');
    mocks.prismaMock.token.findMany.mockResolvedValue([expiredToken]);
    mocks.prismaMock.token.updateMany.mockResolvedValue({ count: 1 });
  });

  it('marks due tokens EXPIRED and emits token.expired once each', async () => {
    const result = await sweepExpiredTokens();
    expect(result.expired).toBe(1);
    expect(mocks.prismaMock.token.updateMany).toHaveBeenCalledTimes(1);
    expect(mocks.emitEventMock).toHaveBeenCalledTimes(1);
    const [eventType, payload] = mocks.emitEventMock.mock.calls[0];
    expect(eventType).toBe('token.expired');
    // Must carry merchantId or the SSE stream drops it as unscoped.
    expect(payload.merchantId).toBe('m-1');
  });

  it('only updates tokens still ACTIVE, so a concurrent redeem is not clobbered', async () => {
    await sweepExpiredTokens();
    const where = mocks.prismaMock.token.updateMany.mock.calls[0][0].where;
    expect(where.status).toBe(TokenStatus.ACTIVE);
  });

  it('invalidates the wallet cache so expired tokens vanish from queries', async () => {
    mocks.redisMock.keys.mockResolvedValue(['wallet:c-1:sandbox:q']);
    await sweepExpiredTokens();
    expect(mocks.redisMock.del).toHaveBeenCalledWith('wallet:c-1:sandbox:q');
  });

  it('skips the tick when another instance holds the lock', async () => {
    mocks.redisMock.set.mockResolvedValue(null);
    const result = await sweepExpiredTokens();
    expect(result.skipped).toBe(true);
    expect(mocks.emitEventMock).not.toHaveBeenCalled();
  });

  it('skips rather than risking duplicate webhooks when Redis is unavailable', async () => {
    mocks.redisMock.set.mockRejectedValue(new Error('redis down'));
    const result = await sweepExpiredTokens();
    expect(result.skipped).toBe(true);
    expect(mocks.prismaMock.token.updateMany).not.toHaveBeenCalled();
  });
});
