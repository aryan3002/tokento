import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TokenStatus } from '@tokento/shared';

const mocks = vi.hoisted(() => {
  const prismaMock = {
    redemption: {
      findUnique: vi.fn(),
      create: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
    },
    token: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    $transaction: vi.fn(),
  };

  return {
    prismaMock,
    redisMock: {
      keys: vi.fn(async () => []),
      del: vi.fn(async () => 0),
    },
    emitEventMock: vi.fn(),
    generateSettlementRefMock: vi.fn(() => 'stl_test_ref'),
    validationMock: vi.fn(),
    loggerMock: {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
  };
});

vi.mock('../src/db/client', () => ({ default: mocks.prismaMock }));
vi.mock('../src/db/redis', () => ({ default: mocks.redisMock }));
vi.mock('../src/events/emitter', () => ({ emitEvent: mocks.emitEventMock }));
vi.mock('../src/utils/ids', () => ({ generateSettlementRef: mocks.generateSettlementRefMock }));
vi.mock('../src/utils/logger', () => ({ logger: mocks.loggerMock }));
vi.mock('../src/services/validation.service', () => ({
  validationService: {
    validate: mocks.validationMock,
  },
}));

import { redemptionService } from '../src/services/redemption.service';
import { AppError } from '../src/middleware/error.middleware';

describe('redemption service', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mocks.prismaMock.redemption.findUnique.mockResolvedValue(null);
    mocks.prismaMock.token.findUnique.mockResolvedValue({
      id: 'token-1',
      customerId: 'customer-1',
      denomination: 5,
      status: TokenStatus.ACTIVE,
    });
    mocks.prismaMock.token.update.mockResolvedValue({
      id: 'token-1',
      status: TokenStatus.REDEEMED,
    });
    mocks.prismaMock.redemption.create.mockResolvedValue({
      id: 'redemption-1',
      netValue: 25,
    });
    mocks.prismaMock.$transaction.mockResolvedValue([
      { id: 'token-1', status: TokenStatus.REDEEMED },
      { id: 'redemption-1', netValue: 25 },
    ]);
    mocks.validationMock.mockResolvedValue({
      valid: true,
      reasonCode: null,
      reasonMessage: null,
    });
  });

  it('returns existing redemption for idempotent duplicate', async () => {
    mocks.prismaMock.redemption.findUnique.mockResolvedValue({
      id: 'existing-redemption',
      tokenId: 'token-1',
      netValue: 25,
      tokenDenomination: 5,
      settlementRef: 'stl_existing',
    });

    const result = await redemptionService.redeem('token-1', {
      transactionAmount: 30,
      merchantId: 'merchant-1',
      idempotencyKey: 'idem-1',
    }, true);

    expect(result.alreadyRedeemed).toBe(true);
    expect(result.redemptionId).toBe('existing-redemption');
    expect(mocks.validationMock).not.toHaveBeenCalled();
    expect(mocks.prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('performs atomic redeem transaction on valid token', async () => {
    const result = await redemptionService.redeem('token-1', {
      transactionAmount: 30,
      merchantId: 'merchant-1',
      idempotencyKey: 'idem-2',
      agentId: 'agent-1',
    }, true);

    expect(mocks.validationMock).toHaveBeenCalledTimes(1);
    expect(mocks.prismaMock.$transaction).toHaveBeenCalledTimes(1);
    expect(result.alreadyRedeemed).toBe(false);
    expect(result.netTransactionValue).toBe(25);
    expect(result.settlementReference).toBe('stl_test_ref');
    expect(mocks.emitEventMock).toHaveBeenCalledTimes(1);
  });

  it('throws validation_failed when validation rejects redemption', async () => {
    mocks.validationMock.mockResolvedValue({
      valid: false,
      reasonCode: 'signature_invalid',
      reasonMessage: 'Token signature verification failed.',
    });

    await expect(() => redemptionService.redeem('token-1', {
      transactionAmount: 30,
      merchantId: 'merchant-1',
      idempotencyKey: 'idem-3',
    }, true)).rejects.toMatchObject<AppError>({
      code: 'validation_failed',
      statusCode: 400,
    });
  });
});
