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

export class RedemptionService {
  async redeem(tokenId: string, data: RedeemTokenRequest, isSandbox?: boolean): Promise<RedeemTokenResponse> {
    // Idempotent duplicate check
    const existing = await prisma.redemption.findUnique({ where: { tokenId } });
    if (existing) {
      return {
        redemptionId: existing.id, tokenId,
        netTransactionValue: existing.netValue,
        tokenDenomination: existing.tokenDenomination,
        settlementReference: existing.settlementRef,
        alreadyRedeemed: true,
      };
    }

    // Re-validate
    const validation = await validationService.validate(tokenId, {
      transactionAmount: data.transactionAmount,
      merchantId: data.merchantId,
      agentId: data.agentId,
    }, isSandbox);

    if (!validation.valid) {
      throw new AppError(400, 'validation_failed', `Token validation failed: ${validation.reasonMessage}`, { reasonCode: validation.reasonCode, tokenId });
    }

    const token = await prisma.token.findUnique({ where: { id: tokenId } });
    if (!token) throw new AppError(404, 'token_not_found', 'Token not found.');

    const netValue = Math.max(0, data.transactionAmount - token.denomination);
    const settlementRef = generateSettlementRef();

    // Atomic update + redemption log
    const [, redemption] = await prisma.$transaction([
      prisma.token.update({
        where: { id: tokenId, status: TokenStatus.ACTIVE },
        data: { status: TokenStatus.REDEEMED, redeemedAt: new Date() },
      }),
      prisma.redemption.create({
        data: {
          tokenId, merchantId: data.merchantId, customerId: token.customerId,
          transactionAmount: data.transactionAmount, tokenDenomination: token.denomination,
          netValue, agentId: data.agentId || null, settlementRef,
        },
      }),
    ]);

    // Invalidate cache
    const keys = await redis.keys(`wallet:${token.customerId}:*`).catch(() => [] as string[]);
    if (keys.length > 0) await redis.del(...keys).catch(() => {});

    emitEvent(EventType.TOKEN_REDEEMED, {
      tokenId, redemptionId: redemption.id, merchantId: data.merchantId,
      customerId: token.customerId, denomination: token.denomination,
      transactionAmount: data.transactionAmount, netValue, agentId: data.agentId, settlementRef,
    });

    logger.info({ redemptionId: redemption.id, tokenId, denomination: token.denomination, netValue }, 'Token redeemed');

    return {
      redemptionId: redemption.id, tokenId,
      netTransactionValue: redemption.netValue,
      tokenDenomination: token.denomination,
      settlementReference: settlementRef,
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
