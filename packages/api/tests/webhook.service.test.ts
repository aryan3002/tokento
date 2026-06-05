import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EventType } from '@tokento/shared';

const mocks = vi.hoisted(() => {
  const prismaMock = {
    webhookEndpoint: {
      findMany: vi.fn(),
    },
    webhookDelivery: {
      findMany: vi.fn(),
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
      text: vi.fn(async () => 'upstream failed'),
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
    mocks.prismaMock.webhookDelivery.findMany.mockResolvedValue([]);
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

  it('lists webhook deliveries with endpoint metadata and retry count', async () => {
    mocks.prismaMock.webhookDelivery.findMany.mockResolvedValue([{
      id: 'delivery-2',
      webhookEndpointId: 'endpoint-1',
      eventType: EventType.TOKEN_REDEEMED,
      responseCode: 500,
      responseBody: 'upstream_failed',
      attempts: 3,
      nextRetryAt: new Date('2026-05-26T20:00:00.000Z'),
      deliveredAt: null,
      createdAt: new Date('2026-05-26T19:00:00.000Z'),
      webhookEndpoint: {
        id: 'endpoint-1',
        url: 'https://example.test/webhook',
      },
    }]);

    const results = await webhookService.listDeliveries('merchant-1', {
      endpointId: 'endpoint-1',
      limit: 10,
    });

    expect(mocks.prismaMock.webhookDelivery.findMany).toHaveBeenCalledTimes(1);
    const where = mocks.prismaMock.webhookDelivery.findMany.mock.calls[0]?.[0]?.where;
    expect(where.webhookEndpoint.merchantId).toBe('merchant-1');
    expect(where.webhookEndpointId).toBe('endpoint-1');

    expect(results).toHaveLength(1);
    expect(results[0].endpointUrl).toBe('https://example.test/webhook');
    expect(results[0].retryCount).toBe(2);
  });
});
