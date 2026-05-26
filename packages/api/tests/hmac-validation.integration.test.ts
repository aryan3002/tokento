import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TokenStatus, ValidationReasonCode } from '@tokento/shared';

const mocks = vi.hoisted(() => {
  let storedToken: Record<string, any> | null = null;

  const prismaMock = {
    token: {
      findUnique: vi.fn(async (args: any) => {
        if (args?.where?.idempotencyKey_merchantId) return null;
        if (args?.where?.id && storedToken?.id === args.where.id) return storedToken;
        return null;
      }),
      create: vi.fn(async (args: any) => {
        const data = args.data;
        storedToken = {
          ...data,
          tokenType: data.tokenType,
          status: data.status,
          issuedAt: new Date(),
          createdAt: new Date(),
          updatedAt: new Date(),
          redeemedAt: null,
        };
        return storedToken;
      }),
      update: vi.fn(async ({ where, data }: any) => {
        if (storedToken?.id === where.id) {
          storedToken = { ...storedToken, ...data, updatedAt: new Date() };
        }
        return storedToken;
      }),
    },
    earnRule: {
      findUnique: vi.fn(async () => ({
        id: '33333333-3333-4333-8333-333333333333',
        merchantId: '11111111-1111-4111-8111-111111111111',
        tokenDenomination: 5,
        spendThreshold: 20,
        expiryDays: 90,
        isActive: true,
        categoryRestriction: null,
        channelRestriction: null,
        stackabilityFlag: true,
        agentPresentableFlag: true,
        minimumTransactionFloor: 0,
      })),
    },
    wallet: {
      findUnique: vi.fn(async () => null),
      create: vi.fn(async ({ data }: any) => data),
    },
  };

  const redisMock = {
    keys: vi.fn(async () => []),
    del: vi.fn(async () => 0),
  };

  const emitEventMock = vi.fn();
  const loggerMock = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };

  const setStoredToken = (token: Record<string, any>) => {
    storedToken = token;
  };

  const getStoredToken = () => storedToken;

  return {
    prismaMock,
    redisMock,
    emitEventMock,
    loggerMock,
    setStoredToken,
    getStoredToken,
  };
});

vi.mock('../src/db/client', () => ({
  default: mocks.prismaMock,
}));

vi.mock('../src/db/redis', () => ({
  default: mocks.redisMock,
}));

vi.mock('../src/events/emitter', () => ({
  emitEvent: mocks.emitEventMock,
}));

vi.mock('../src/utils/logger', () => ({
  logger: mocks.loggerMock,
}));

import { tokenService } from '../src/services/token.service';
import { validationService } from '../src/services/validation.service';

describe('HMAC validation integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects tampered token payload with signature_invalid', async () => {
    const merchantId = '11111111-1111-4111-8111-111111111111';
    const customerId = '22222222-2222-4222-8222-222222222222';
    const earnRuleId = '33333333-3333-4333-8333-333333333333';

    const mintResult = await tokenService.mint(
      {
        merchantId,
        customerId,
        transactionAmount: 30,
        earnRuleId,
        idempotencyKey: 'idem-hmac-test-1',
      },
      true
    );

    expect(mintResult.token.status).toBe(TokenStatus.ACTIVE);

    const minted = mocks.getStoredToken();
    expect(minted).toBeTruthy();

    mocks.setStoredToken({
      ...minted,
      denomination: minted!.denomination + 1,
    });

    const result = await validationService.validate(mintResult.token.id, {
      transactionAmount: 35,
      merchantId,
      agentId: 'agent-test',
    }, true);

    expect(result.valid).toBe(false);
    expect(result.reasonCode).toBe(ValidationReasonCode.SIGNATURE_INVALID);
  });
});
