import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  redisMock: { set: vi.fn(), del: vi.fn(async () => 1) },
  serviceMock: { retryPendingDeliveries: vi.fn() },
  loggerMock: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../src/db/redis', () => ({ default: mocks.redisMock }));
vi.mock('../src/services/webhook.service', () => ({ webhookService: mocks.serviceMock }));
vi.mock('../src/utils/logger', () => ({ logger: mocks.loggerMock }));

import { runWebhookRetries } from '../src/jobs/webhook-retry';

describe('webhook retry worker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.redisMock.set.mockResolvedValue('OK');
    mocks.serviceMock.retryPendingDeliveries.mockResolvedValue({ retried: 2 });
  });

  it('dispatches pending retries when it holds the lock', async () => {
    const result = await runWebhookRetries();
    expect(result).toEqual({ retried: 2, skipped: false });
  });

  it('releases the lock so the next tick is not throttled to the TTL', async () => {
    await runWebhookRetries();
    expect(mocks.redisMock.del).toHaveBeenCalledWith('jobs:webhook-retry:lock');
  });

  it('releases the lock even when the sweep throws', async () => {
    mocks.serviceMock.retryPendingDeliveries.mockRejectedValue(new Error('boom'));
    const result = await runWebhookRetries();
    expect(result.retried).toBe(0);
    expect(mocks.redisMock.del).toHaveBeenCalled();
  });

  it('skips when another instance holds the lock', async () => {
    mocks.redisMock.set.mockResolvedValue(null);
    const result = await runWebhookRetries();
    expect(result.skipped).toBe(true);
    expect(mocks.serviceMock.retryPendingDeliveries).not.toHaveBeenCalled();
  });
});
