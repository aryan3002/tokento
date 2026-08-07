// ============================================================
// Tokento — Validation Service
// ============================================================
// POST /v1/tokens/{id}/validate — Stateless validation
// P0: ≤80ms p99
// Checks: not expired, merchant match, amount ≥ floor,
//         agent_presentable_flag, channel match, not redeemed,
//         HMAC signature verification (Revision #7)

import prisma from '../db/client';
import { verifyTokenSignature } from '../utils/crypto';
import { moneyLessThan, toMoneyNumber } from '../utils/money';
import { logger } from '../utils/logger';
import { emitEvent } from '../events/emitter';
import {
  EventType,
  TokenStatus,
  ValidateTokenRequest,
  ValidateTokenResponse,
  ValidationReasonCode,
} from '@tokento/shared';

export class ValidationService {
  /**
   * Validate a token for a specific transaction context.
   * Returns pass/fail with detailed reason code.
   */
  async validate(
    tokenId: string,
    data: ValidateTokenRequest,
    isSandbox: boolean
  ): Promise<ValidateTokenResponse> {
    const token = await prisma.token.findUnique({
      where: { id: tokenId },
    });

    if (!token) {
      return {
        valid: false,
        tokenId,
        denomination: 0,
        reasonCode: ValidationReasonCode.TOKEN_NOT_FOUND,
        reasonMessage: 'Token not found.',
      };
    }

    // Sandbox/production isolation check
    if (token.isSandbox !== isSandbox) {
      return {
        valid: false,
        tokenId,
        denomination: toMoneyNumber(token.denomination),
        reasonCode: ValidationReasonCode.SANDBOX_PRODUCTION_MISMATCH,
        reasonMessage: token.isSandbox
          ? 'Sandbox token cannot be used in production.'
          : 'Production token cannot be used in sandbox.',
      };
    }

    // Check if already redeemed
    if (token.status === TokenStatus.REDEEMED) {
      return {
        valid: false,
        tokenId,
        denomination: toMoneyNumber(token.denomination),
        reasonCode: ValidationReasonCode.TOKEN_REDEEMED,
        reasonMessage: 'Token has already been redeemed.',
      };
    }

    // Check expiry
    if (new Date() > token.expiryAt) {
      // Auto-mark as expired
      await prisma.token.update({
        where: { id: tokenId },
        data: { status: TokenStatus.EXPIRED },
      });

      return {
        valid: false,
        tokenId,
        denomination: toMoneyNumber(token.denomination),
        reasonCode: ValidationReasonCode.TOKEN_EXPIRED,
        reasonMessage: `Token expired at ${token.expiryAt.toISOString()}.`,
      };
    }

    // Check merchant match
    if (token.merchantId !== data.merchantId) {
      return {
        valid: false,
        tokenId,
        denomination: toMoneyNumber(token.denomination),
        reasonCode: ValidationReasonCode.MERCHANT_MISMATCH,
        reasonMessage: 'Token was issued by a different merchant.',
      };
    }

    // Check transaction amount ≥ minimum floor
    if (moneyLessThan(data.transactionAmount, token.minimumTransactionFloor)) {
      return {
        valid: false,
        tokenId,
        denomination: toMoneyNumber(token.denomination),
        reasonCode: ValidationReasonCode.AMOUNT_BELOW_FLOOR,
        reasonMessage: `Transaction amount $${data.transactionAmount} is below the minimum floor of $${token.minimumTransactionFloor}.`,
      };
    }

    // Check agent presentable flag
    if (!token.agentPresentableFlag) {
      return {
        valid: false,
        tokenId,
        denomination: toMoneyNumber(token.denomination),
        reasonCode: ValidationReasonCode.NOT_AGENT_PRESENTABLE,
        reasonMessage: 'Token is not presentable by AI agents.',
      };
    }

    // Check channel restriction
    if (
      token.channelRestriction &&
      data.channel &&
      token.channelRestriction !== data.channel
    ) {
      return {
        valid: false,
        tokenId,
        denomination: toMoneyNumber(token.denomination),
        reasonCode: ValidationReasonCode.CHANNEL_MISMATCH,
        reasonMessage: `Token is restricted to channel '${token.channelRestriction}'.`,
      };
    }

    // Verify HMAC signature (Revision #7)
    try {
      const signatureValid = verifyTokenSignature({
        tokenId: token.id,
        merchantId: token.merchantId,
        customerId: token.customerId,
        denomination: toMoneyNumber(token.denomination),
        expiryAt: token.expiryAt.toISOString(),
        isSandbox: token.isSandbox,
        minimumTransactionFloor: toMoneyNumber(token.minimumTransactionFloor),
        agentPresentableFlag: token.agentPresentableFlag,
        signature: token.signature,
      });

      if (!signatureValid) {
        return {
          valid: false,
          tokenId,
          denomination: toMoneyNumber(token.denomination),
          reasonCode: ValidationReasonCode.SIGNATURE_INVALID,
          reasonMessage: 'Token signature verification failed.',
        };
      }
    } catch (err) {
      logger.error({ err, tokenId }, 'Signature verification error');
      return {
        valid: false,
        tokenId,
        denomination: toMoneyNumber(token.denomination),
        reasonCode: ValidationReasonCode.SIGNATURE_INVALID,
        reasonMessage: 'Token signature verification failed.',
      };
    }

    // All checks passed
    emitEvent(EventType.TOKEN_VALIDATED, {
      tokenId,
      merchantId: data.merchantId,
      agentId: data.agentId,
      valid: true,
    });

    return {
      valid: true,
      tokenId,
      denomination: toMoneyNumber(token.denomination),
      reasonCode: null,
      reasonMessage: null,
    };
  }
}

export const validationService = new ValidationService();
