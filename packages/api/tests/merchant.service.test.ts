import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../src/middleware/error.middleware';
import { EventType } from '@tokento/shared';

const mocks = vi.hoisted(() => {
  const prismaMock = {
    merchant: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    apiKey: {
      create: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    earnRule: {
      create: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    token: {
      findMany: vi.fn(),
    },
    redemption: {
      findMany: vi.fn(),
    },
  };

  return {
    prismaMock,
    emitEventMock: vi.fn(),
    loggerMock: {
      info: vi.fn(),
    },
    generateApiKeyMock: vi.fn(() => ({
      rawKey: 'tk_live_test',
      keyPrefix: 'tk',
      keyHash: 'hash',
    })),
  };
});

vi.mock('../src/db/client', () => ({ default: mocks.prismaMock }));
vi.mock('../src/events/emitter', () => ({ emitEvent: mocks.emitEventMock }));
vi.mock('../src/utils/logger', () => ({ logger: mocks.loggerMock }));
vi.mock('../src/utils/ids', () => ({ generateApiKey: mocks.generateApiKeyMock }));

import { merchantService } from '../src/services/merchant.service';

describe('merchant service', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mocks.prismaMock.merchant.findUnique.mockResolvedValue(null);
    mocks.prismaMock.merchant.create.mockResolvedValue({
      id: 'merchant-1',
      name: 'Test Merchant',
      email: 'm@example.com',
      isSandbox: true,
    });
    mocks.prismaMock.apiKey.create.mockResolvedValue({ id: 'key-1' });
    mocks.prismaMock.earnRule.create.mockResolvedValue({ id: 'rule-1', merchantId: 'merchant-1' });
    mocks.prismaMock.earnRule.findMany.mockResolvedValue([]);
    mocks.prismaMock.token.findMany.mockResolvedValue([]);
    mocks.prismaMock.redemption.findMany.mockResolvedValue([]);
    mocks.prismaMock.apiKey.findMany.mockResolvedValue([]);
    mocks.prismaMock.earnRule.findUnique.mockResolvedValue({ id: 'rule-1', merchantId: 'merchant-1' });
    mocks.prismaMock.earnRule.update.mockResolvedValue({ id: 'rule-1' });
    mocks.prismaMock.apiKey.findUnique.mockResolvedValue({ id: 'key-1', merchantId: 'merchant-1' });
    mocks.prismaMock.apiKey.update.mockResolvedValue({ id: 'key-1', isActive: false });
    mocks.prismaMock.merchant.update.mockResolvedValue({ id: 'merchant-1', agentOptIn: false });
  });

  it('creates merchant with initial API key and emits event', async () => {
    const result = await merchantService.create({
      name: 'Test Merchant',
      email: 'm@example.com',
    });

    expect(result.merchant.id).toBe('merchant-1');
    expect(result.apiKey).toBe('tk_live_test');
    expect(mocks.prismaMock.apiKey.create).toHaveBeenCalledTimes(1);
    expect(mocks.emitEventMock).toHaveBeenCalledWith(EventType.MERCHANT_CREATED, expect.any(Object));
  });

  it('throws on duplicate merchant email', async () => {
    mocks.prismaMock.merchant.findUnique.mockResolvedValue({ id: 'existing' });

    await expect(() => merchantService.create({
      name: 'Existing',
      email: 'm@example.com',
    })).rejects.toMatchObject<AppError>({
      statusCode: 409,
      code: 'merchant_exists',
    });
  });

  it('throws when merchant is not found', async () => {
    mocks.prismaMock.merchant.findUnique.mockResolvedValueOnce(null);

    await expect(() => merchantService.getById('missing')).rejects.toMatchObject<AppError>({
      statusCode: 404,
      code: 'merchant_not_found',
    });
  });

  it('updates merchant config and earn rules', async () => {
    await merchantService.updateConfig('merchant-1', { agentOptIn: false });

    await merchantService.createEarnRule('merchant-1', {
      name: 'rule',
      spendThreshold: 10,
      tokenDenomination: 2,
    });

    await merchantService.getEarnRules('merchant-1');
    await merchantService.updateEarnRule('merchant-1', 'rule-1', { spendThreshold: 20 });

    expect(mocks.prismaMock.merchant.update).toHaveBeenCalledTimes(1);
    expect(mocks.prismaMock.earnRule.create).toHaveBeenCalledTimes(1);
    expect(mocks.prismaMock.earnRule.findMany).toHaveBeenCalledTimes(1);
    expect(mocks.prismaMock.earnRule.update).toHaveBeenCalledTimes(1);
    expect(mocks.emitEventMock).toHaveBeenCalledWith(EventType.EARN_RULE_CREATED, expect.any(Object));
    expect(mocks.emitEventMock).toHaveBeenCalledWith(EventType.EARN_RULE_UPDATED, expect.any(Object));
  });

  it('throws when updating missing earn rule', async () => {
    mocks.prismaMock.earnRule.findUnique.mockResolvedValueOnce(null);

    await expect(() => merchantService.updateEarnRule('merchant-1', 'rule-missing', { spendThreshold: 20 })).rejects.toMatchObject<AppError>({
      statusCode: 404,
      code: 'earn_rule_not_found',
    });
  });

  it('lists tokens, redemptions, and API keys and supports create/revoke', async () => {
    await merchantService.getTokens('merchant-1');
    await merchantService.getRedemptions('merchant-1');
    await merchantService.createApiKey('merchant-1', { scopes: ['token:mint'], expiresInDays: 10 });
    await merchantService.listApiKeys('merchant-1');
    await merchantService.revokeApiKey('merchant-1', 'key-1');

    expect(mocks.prismaMock.token.findMany).toHaveBeenCalledTimes(1);
    expect(mocks.prismaMock.redemption.findMany).toHaveBeenCalledTimes(1);
    expect(mocks.prismaMock.apiKey.create).toHaveBeenCalledTimes(1);
    expect(mocks.prismaMock.apiKey.findMany).toHaveBeenCalledTimes(1);
    expect(mocks.prismaMock.apiKey.update).toHaveBeenCalledTimes(1);
  });

  it('throws when revoking unknown API key', async () => {
    mocks.prismaMock.apiKey.findUnique.mockResolvedValueOnce(null);

    await expect(() => merchantService.revokeApiKey('merchant-1', 'missing')).rejects.toMatchObject<AppError>({
      statusCode: 404,
      code: 'api_key_not_found',
    });
  });
});
