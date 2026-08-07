// ============================================================
// Tokento — Redemption Service
// ============================================================
import prisma from '../db/client';
import redis from '../db/redis';
import { logger } from '../utils/logger';
import { emitEvent } from '../events/emitter';
import { generateSettlementRef } from '../utils/ids';
import { validationService } from './validation.service';
import { EventType, TokenStatus, RedeemTokenRequest, RedeemTokenResponse } from '@tokento/shared';
import { AppError } from '../middleware/error.middleware';
import { subtractMoneyFloorZero, toMoneyNumber } from '../utils/money';
import { invalidateWalletCache } from '../utils/wallet-cache';
import { SettlementStatus } from '@tokento/shared';

/**
 * Settlement is a stub. There is no ledger, no journal and no payout pipeline —
 * a redemption records that value was applied at checkout, nothing more. This is
 * surfaced in the API response rather than left implicit so the stub cannot leak
 * into an integrator's business logic as if funds had moved.
 */
function settlementStatus(): SettlementStatus {
  return process.env.SETTLEMENT_ENABLED === 'true' ? 'pending' : 'not_implemented';
}

export interface RedeemOptions {
  isSandbox: boolean;
  /**
   * The customer established by authentication. Required — a redemption may only be
   * performed by the token's owner, and making this mandatory means the compiler
   * rejects any call site that forgets to pass it.
   */
  authenticatedCustomerId: string;
}

export class RedemptionService {
  async redeem(tokenId: string, data: RedeemTokenRequest, opts: RedeemOptions): Promise<RedeemTokenResponse> {
    // Ownership is checked before anything else, including the duplicate-redemption
    // early return — otherwise that path leaks another customer's redemption record.
    const token = await prisma.token.findUnique({ where: { id: tokenId } });
    if (!token) throw new AppError(404, 'token_not_found', 'Token not found.');

    if (token.customerId !== opts.authenticatedCustomerId) {
      throw new AppError(403, 'forbidden', 'Token does not belong to the authenticated customer.', { tokenId });
    }

    // Idempotent duplicate check
    const existing = await prisma.redemption.findUnique({ where: { tokenId } });
    if (existing) {
      return {
        redemptionId: existing.id, tokenId,
        netTransactionValue: toMoneyNumber(existing.netValue),
        tokenDenomination: toMoneyNumber(existing.tokenDenomination),
        settlementReference: existing.settlementRef,
        settlementStatus: settlementStatus(),
        alreadyRedeemed: true,
      };
    }

    // Re-validate
    const validation = await validationService.validate(tokenId, {
      transactionAmount: data.transactionAmount,
      merchantId: data.merchantId,
      agentId: data.agentId,
    }, opts.isSandbox);

    if (!validation.valid) {
      throw new AppError(400, 'validation_failed', `Token validation failed: ${validation.reasonMessage}`, { reasonCode: validation.reasonCode, tokenId });
    }

    const netValue = subtractMoneyFloorZero(data.transactionAmount, token.denomination);
    const settlementRef = generateSettlementRef();

    // Interactive transaction: the conditional status flip and the redemption insert
    // share one scope. updateMany returns a count instead of throwing P2025, so a lost
    // race surfaces as a 409 the caller can act on rather than a 500 it will retry.
    const redemption = await prisma.$transaction(async (tx) => {
      const updated = await tx.token.updateMany({
        where: { id: tokenId, status: TokenStatus.ACTIVE },
        data: { status: TokenStatus.REDEEMED, redeemedAt: new Date() },
      });

      if (updated.count === 0) {
        throw new AppError(409, 'already_redeemed', 'Token is no longer active.', { tokenId });
      }

      return tx.redemption.create({
        data: {
          tokenId, merchantId: data.merchantId, customerId: token.customerId,
          transactionAmount: data.transactionAmount, tokenDenomination: token.denomination,
          netValue, agentId: data.agentId || null, settlementRef,
        },
      });
    });

    // Invalidate cache
    await invalidateWalletCache(token.customerId);

    emitEvent(EventType.TOKEN_REDEEMED, {
      tokenId, redemptionId: redemption.id, merchantId: data.merchantId,
      customerId: token.customerId, denomination: toMoneyNumber(token.denomination),
      transactionAmount: data.transactionAmount, netValue: toMoneyNumber(netValue),
      agentId: data.agentId, settlementRef,
    });

    logger.info({ redemptionId: redemption.id, tokenId, denomination: toMoneyNumber(token.denomination), netValue: toMoneyNumber(netValue) }, 'Token redeemed');

    return {
      redemptionId: redemption.id, tokenId,
      netTransactionValue: toMoneyNumber(redemption.netValue),
      tokenDenomination: toMoneyNumber(token.denomination),
      settlementReference: settlementRef,
      settlementStatus: settlementStatus(),
      alreadyRedeemed: false,
    };
  }

  async getByMerchant(merchantId: string, page = 1, limit = 20) {
    const [redemptions, total] = await Promise.all([
      prisma.redemption.findMany({ where: { merchantId }, orderBy: { redeemedAt: 'desc' }, skip: (page - 1) * limit, take: limit }),
      prisma.redemption.count({ where: { merchantId } }),
    ]);
    return { redemptions, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
  }
}

export const redemptionService = new RedemptionService();
