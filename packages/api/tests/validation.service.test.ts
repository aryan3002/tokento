import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TokenStatus, ValidationReasonCode } from '@tokento/shared';

const mocks = vi.hoisted(() => {
  const prismaMock = {
    token: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  };

  return {
    prismaMock,
    verifySignatureMock: vi.fn(() => true),
    emitEventMock: vi.fn(),
    loggerMock: {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
  };
});

vi.mock('../src/db/client', () => ({ default: mocks.prismaMock }));
vi.mock('../src/utils/crypto', () => ({ verifyTokenSignature: mocks.verifySignatureMock }));
vi.mock('../src/events/emitter', () => ({ emitEvent: mocks.emitEventMock }));
vi.mock('../src/utils/logger', () => ({ logger: mocks.loggerMock }));

import { validationService } from '../src/services/validation.service';

function makeToken(overrides: Record<string, unknown> = {}) {
  return {
    id: 'token-1',
    merchantId: 'merchant-1',
    customerId: 'customer-1',
    denomination: 5,
    status: TokenStatus.ACTIVE,
    expiryAt: new Date(Date.now() + 3600_000),
    minimumTransactionFloor: 10,
    agentPresentableFlag: true,
    channelRestriction: null,
    isSandbox: true,
    signature: 'signature',
    ...overrides,
  };
}

describe('validation service reason codes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.prismaMock.token.update.mockResolvedValue(undefined);
  });

  it('returns token_not_found when token does not exist', async () => {
    mocks.prismaMock.token.findUnique.mockResolvedValue(null);

    const result = await validationService.validate('missing', {
      transactionAmount: 50,
      merchantId: 'merchant-1',
    }, true);

    expect(result.reasonCode).toBe(ValidationReasonCode.TOKEN_NOT_FOUND);
  });

  it('returns token_redeemed when status is redeemed', async () => {
    mocks.prismaMock.token.findUnique.mockResolvedValue(makeToken({
      status: TokenStatus.REDEEMED,
    }));

    const result = await validationService.validate('token-1', {
      transactionAmount: 50,
      merchantId: 'merchant-1',
    }, true);

    expect(result.reasonCode).toBe(ValidationReasonCode.TOKEN_REDEEMED);
  });

  it('returns token_expired and updates status when expired', async () => {
    mocks.prismaMock.token.findUnique.mockResolvedValue(makeToken({
      expiryAt: new Date(Date.now() - 3600_000),
    }));

    const result = await validationService.validate('token-1', {
      transactionAmount: 50,
      merchantId: 'merchant-1',
    }, true);

    expect(result.reasonCode).toBe(ValidationReasonCode.TOKEN_EXPIRED);
    expect(mocks.prismaMock.token.update).toHaveBeenCalledTimes(1);
  });

  it('returns merchant_mismatch', async () => {
    mocks.prismaMock.token.findUnique.mockResolvedValue(makeToken({
      merchantId: 'merchant-other',
    }));

    const result = await validationService.validate('token-1', {
      transactionAmount: 50,
      merchantId: 'merchant-1',
    }, true);

    expect(result.reasonCode).toBe(ValidationReasonCode.MERCHANT_MISMATCH);
  });

  it('returns amount_below_floor', async () => {
    mocks.prismaMock.token.findUnique.mockResolvedValue(makeToken({
      minimumTransactionFloor: 100,
    }));

    const result = await validationService.validate('token-1', {
      transactionAmount: 50,
      merchantId: 'merchant-1',
    }, true);

    expect(result.reasonCode).toBe(ValidationReasonCode.AMOUNT_BELOW_FLOOR);
  });

  it('returns not_agent_presentable', async () => {
    mocks.prismaMock.token.findUnique.mockResolvedValue(makeToken({
      agentPresentableFlag: false,
    }));

    const result = await validationService.validate('token-1', {
      transactionAmount: 50,
      merchantId: 'merchant-1',
    }, true);

    expect(result.reasonCode).toBe(ValidationReasonCode.NOT_AGENT_PRESENTABLE);
  });

  it('returns channel_mismatch', async () => {
    mocks.prismaMock.token.findUnique.mockResolvedValue(makeToken({
      channelRestriction: 'in_store',
    }));

    const result = await validationService.validate('token-1', {
      transactionAmount: 50,
      merchantId: 'merchant-1',
      channel: 'online',
    }, true);

    expect(result.reasonCode).toBe(ValidationReasonCode.CHANNEL_MISMATCH);
  });

  it('returns signature_invalid when signature verification fails', async () => {
    mocks.prismaMock.token.findUnique.mockResolvedValue(makeToken());
    mocks.verifySignatureMock.mockReturnValueOnce(false);

    const result = await validationService.validate('token-1', {
      transactionAmount: 50,
      merchantId: 'merchant-1',
    }, true);

    expect(result.reasonCode).toBe(ValidationReasonCode.SIGNATURE_INVALID);
  });

  it('returns valid true when checks pass', async () => {
    mocks.prismaMock.token.findUnique.mockResolvedValue(makeToken());
    mocks.verifySignatureMock.mockReturnValueOnce(true);

    const result = await validationService.validate('token-1', {
      transactionAmount: 50,
      merchantId: 'merchant-1',
      agentId: 'agent-1',
    }, true);

    expect(result.valid).toBe(true);
    expect(result.reasonCode).toBeNull();
    expect(mocks.emitEventMock).toHaveBeenCalledTimes(1);
  });
});
