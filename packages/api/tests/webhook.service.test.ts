import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EventType } from '@tokento/shared';

const mocks = vi.hoisted(() => {
  const prismaMock = {
    webhookEndpoint: {
      findMany: vi.fn(),
    },
    webhookDelivery: {
      create: vi.fn(),
      update: vi.fn(),
    },
  };

  return {
    prismaMock,
    signWebhookPayloadMock: vi.fn(() => 'whsig_test'),
    loggerMock: {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
    eventBus: {
      on: vi.fn(),
    },
  };
});

vi.mock('../src/db/client', () => ({ default: mocks.prismaMock }));
vi.mock('../src/utils/crypto', () => ({
  generateWebhookSecret: vi.fn(() => 'whsec_test'),
  signWebhookPayload: mocks.signWebhookPayloadMock,
}));
vi.mock('../src/utils/logger', () => ({ logger: mocks.loggerMock }));
vi.mock('../src/events/emitter', () => ({
  eventBus: mocks.eventBus,
  emitEvent: vi.fn(),
}));

import { webhookService } from '../src/services/webhook.service';

describe('webhook service retry behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      status: 500,
    } as Response)));

    mocks.prismaMock.webhookEndpoint.findMany.mockResolvedValue([{
      id: 'endpoint-1',
      merchantId: 'merchant-1',
      url: 'https://example.test/webhook',
      secret: 'whsec_test',
      isActive: true,
      events: [EventType.TOKEN_MINTED],
    }]);
    mocks.prismaMock.webhookDelivery.create.mockResolvedValue({
      id: 'delivery-1',
    });
    mocks.prismaMock.webhookDelivery.update.mockResolvedValue({});
  });

  it('schedules retry when webhook delivery response is not ok', async () => {
    await (webhookService as any).dispatchEvent(EventType.TOKEN_MINTED, {
      merchantId: 'merchant-1',
      tokenId: 'token-1',
    });

    expect(mocks.prismaMock.webhookDelivery.create).toHaveBeenCalledTimes(1);
    expect(mocks.prismaMock.webhookDelivery.update).toHaveBeenCalledTimes(1);

    const updateCall = mocks.prismaMock.webhookDelivery.update.mock.calls[0]?.[0];
    expect(updateCall?.data?.responseCode).toBe(500);
    expect(updateCall?.data?.nextRetryAt).toBeInstanceOf(Date);
    expect(updateCall?.data?.deliveredAt).toBeNull();
  });
});
