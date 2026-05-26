import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TokenStatus, TokenType } from '@tokento/shared';

const mocks = vi.hoisted(() => {
  const prismaMock = {
    token: {
      findMany: vi.fn(),
    },
    wallet: {
      findUnique: vi.fn(),
    },
  };

  const redisMock = {
    get: vi.fn(),
    setex: vi.fn(),
  };

  return {
    prismaMock,
    redisMock,
    loggerMock: {
      debug: vi.fn(),
      warn: vi.fn(),
    },
  };
});

vi.mock('../src/db/client', () => ({ default: mocks.prismaMock }));
vi.mock('../src/db/redis', () => ({ default: mocks.redisMock }));
vi.mock('../src/utils/logger', () => ({ logger: mocks.loggerMock }));

import { walletService } from '../src/services/wallet.service';

describe('wallet service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.redisMock.get.mockResolvedValue(null);
    mocks.redisMock.setex.mockResolvedValue('OK');
    mocks.prismaMock.wallet.findUnique.mockResolvedValue(null);
    mocks.prismaMock.token.findMany.mockResolvedValue([
      {
        id: 'token-1',
        merchantId: 'merchant-1',
        customerId: 'customer-1',
        earnRuleId: 'rule-1',
        denomination: 15,
        tokenType: TokenType.LOYALTY,
        status: TokenStatus.ACTIVE,
        signature: 'sig',
        idempotencyKey: 'idem-1',
        categoryRestriction: null,
        channelRestriction: null,
        stackabilityFlag: true,
        agentPresentableFlag: true,
        minimumTransactionFloor: 0,
        issuedAt: new Date(),
        expiryAt: new Date(Date.now() + 3600_000),
        redeemedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        isSandbox: true,
      },
    ]);
  });

  it('returns cached wallet query response when available', async () => {
    mocks.redisMock.get.mockResolvedValue(JSON.stringify({
      customerId: 'customer-1',
      tokens: [],
      totalValue: 0,
    }));

    const result = await walletService.queryTokens('customer-1', {}, true);

    expect(result.totalValue).toBe(0);
    expect(mocks.prismaMock.token.findMany).not.toHaveBeenCalled();
  });

  it('queries db and caches response with filters', async () => {
    const result = await walletService.queryTokens('customer-1', {
      merchantId: 'merchant-1',
      category: 'grocery',
      channel: 'in_store',
      tokenType: TokenType.LOYALTY,
      minDenomination: 10,
    }, true);

    expect(result.totalValue).toBe(15);
    expect(mocks.prismaMock.token.findMany).toHaveBeenCalledTimes(1);
    const where = mocks.prismaMock.token.findMany.mock.calls[0]?.[0]?.where;
    expect(where.customerId).toBe('customer-1');
    expect(where.isSandbox).toBe(true);
    expect(where.merchantId).toBe('merchant-1');
    expect(where.tokenType).toBe(TokenType.LOYALTY);
    expect(where.denomination.gte).toBe(10);
    expect(mocks.redisMock.setex).toHaveBeenCalledTimes(1);
  });

  it('continues on redis failures and still returns db response', async () => {
    mocks.redisMock.get.mockRejectedValueOnce(new Error('redis read failed'));
    mocks.redisMock.setex.mockRejectedValueOnce(new Error('redis write failed'));

    const result = await walletService.queryTokens('customer-1', {}, false);

    expect(result.tokens).toHaveLength(1);
    expect(result.totalValue).toBe(15);
    expect(mocks.loggerMock.warn).toHaveBeenCalledTimes(2);
  });

  it('reports wallet existence', async () => {
    mocks.prismaMock.wallet.findUnique.mockResolvedValueOnce({ customerId: 'customer-1' });

    await expect(walletService.walletExists('customer-1')).resolves.toBe(true);
    await expect(walletService.walletExists('missing')).resolves.toBe(false);
  });
});
