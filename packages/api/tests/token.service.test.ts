import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TokenStatus, TokenType } from '@tokento/shared';

const mocks = vi.hoisted(() => {
  const prismaMock = {
    token: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    earnRule: {
      findUnique: vi.fn(),
    },
    wallet: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
  };

  const redisMock = {
    keys: vi.fn(async () => []),
    del: vi.fn(async () => 0),
  };

  return {
    prismaMock,
    redisMock,
    signTokenMock: vi.fn(() => 'sig_test'),
    emitEventMock: vi.fn(),
    loggerMock: {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
    uuidMock: vi.fn(() => 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  };
});

vi.mock('../src/db/client', () => ({ default: mocks.prismaMock }));
vi.mock('../src/db/redis', () => ({ default: mocks.redisMock }));
vi.mock('../src/utils/crypto', () => ({ signToken: mocks.signTokenMock }));
vi.mock('../src/events/emitter', () => ({ emitEvent: mocks.emitEventMock }));
vi.mock('../src/utils/logger', () => ({ logger: mocks.loggerMock }));
vi.mock('uuid', () => ({ v4: mocks.uuidMock }));

import { tokenService } from '../src/services/token.service';
import { AppError } from '../src/middleware/error.middleware';

function baseToken(overrides: Record<string, unknown> = {}) {
  return {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    merchantId: '11111111-1111-4111-8111-111111111111',
    customerId: '22222222-2222-4222-8222-222222222222',
    earnRuleId: '33333333-3333-4333-8333-333333333333',
    denomination: 5,
    tokenType: TokenType.LOYALTY,
    status: TokenStatus.ACTIVE,
    signature: 'sig_test',
    idempotencyKey: 'idem-1',
    categoryRestriction: null,
    channelRestriction: null,
    stackabilityFlag: true,
    agentPresentableFlag: true,
    minimumTransactionFloor: 0,
    issuedAt: new Date(),
    expiryAt: new Date(Date.now() + 86400000),
    redeemedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    isSandbox: true,
    ...overrides,
  };
}

describe('token service', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mocks.prismaMock.token.findUnique.mockResolvedValue(null);
    mocks.prismaMock.earnRule.findUnique.mockResolvedValue({
      id: '33333333-3333-4333-8333-333333333333',
      merchantId: '11111111-1111-4111-8111-111111111111',
      isActive: true,
      spendThreshold: 20,
      tokenDenomination: 5,
      expiryDays: 30,
      categoryRestriction: null,
      channelRestriction: null,
      stackabilityFlag: true,
      agentPresentableFlag: true,
      minimumTransactionFloor: 0,
    });
    mocks.prismaMock.wallet.findUnique.mockResolvedValue({ customerId: 'existing-wallet' });
    mocks.prismaMock.wallet.create.mockResolvedValue({ customerId: 'created-wallet' });
    mocks.prismaMock.token.create.mockImplementation(async ({ data }) => baseToken(data));
  });

  it('mints token on happy path', async () => {
    mocks.prismaMock.wallet.findUnique.mockResolvedValue(null);

    const result = await tokenService.mint({
      merchantId: '11111111-1111-4111-8111-111111111111',
      customerId: '22222222-2222-4222-8222-222222222222',
      transactionAmount: 25,
      earnRuleId: '33333333-3333-4333-8333-333333333333',
      idempotencyKey: 'idem-happy-1',
    }, true);

    expect(result.walletCreated).toBe(true);
    expect(result.token.status).toBe(TokenStatus.ACTIVE);
    expect(result.token.tokenType).toBe(TokenType.LOYALTY);
    expect(mocks.prismaMock.token.create).toHaveBeenCalledTimes(1);
    expect(mocks.signTokenMock).toHaveBeenCalledTimes(1);
  });

  it('throws when transaction is below threshold', async () => {
    await expect(() => tokenService.mint({
      merchantId: '11111111-1111-4111-8111-111111111111',
      customerId: '22222222-2222-4222-8222-222222222222',
      transactionAmount: 5,
      earnRuleId: '33333333-3333-4333-8333-333333333333',
      idempotencyKey: 'idem-below-threshold',
    }, true)).rejects.toMatchObject<AppError>({
      code: 'below_spend_threshold',
      statusCode: 400,
    });
  });

  it('returns existing token for idempotent mint', async () => {
    mocks.prismaMock.token.findUnique.mockResolvedValue(baseToken({
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      idempotencyKey: 'idem-existing-1',
    }));

    const result = await tokenService.mint({
      merchantId: '11111111-1111-4111-8111-111111111111',
      customerId: '22222222-2222-4222-8222-222222222222',
      transactionAmount: 50,
      earnRuleId: '33333333-3333-4333-8333-333333333333',
      idempotencyKey: 'idem-existing-1',
    }, true);

    expect(result.walletCreated).toBe(false);
    expect(result.token.id).toBe('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
    expect(mocks.prismaMock.token.create).not.toHaveBeenCalled();
  });
});
