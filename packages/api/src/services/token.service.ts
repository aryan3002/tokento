// ============================================================
// Tokento — Token Issuance Service
// ============================================================
// POST /v1/tokens/mint — Core mint endpoint
// P0: ≤200ms p99, idempotent, expired tokens auto-excluded

import prisma from '../db/client';
import redis from '../db/redis';
import { signToken } from '../utils/crypto';
import { logger } from '../utils/logger';
import { emitEvent } from '../events/emitter';
import { EventType, TokenStatus, MintTokenRequest, MintTokenResponse } from '@tokento/shared';
import { AppError } from '../middleware/error.middleware';

export class TokenService {
  /**
   * Mint a new loyalty token.
   * - Evaluates earn rule threshold
   * - Generates token with HMAC-SHA256 signature
   * - Creates wallet if first mint for customer
   * - Idempotent via idempotencyKey + merchantId unique constraint
   */
  async mint(data: MintTokenRequest, isSandbox: boolean): Promise<MintTokenResponse> {
    const { merchantId, customerId, transactionAmount, earnRuleId, idempotencyKey } = data;

    // Check for idempotent duplicate
    const existingToken = await prisma.token.findUnique({
      where: {
        idempotencyKey_merchantId: {
          idempotencyKey,
          merchantId,
        },
      },
    });

    if (existingToken) {
      logger.debug({ idempotencyKey }, 'Idempotent mint — returning existing token');
      return {
        token: this.mapToken(existingToken),
        walletCreated: false,
      };
    }

    // Fetch earn rule
    const earnRule = await prisma.earnRule.findUnique({
      where: { id: earnRuleId },
    });

    if (!earnRule) {
      throw new AppError(404, 'earn_rule_not_found', 'Earn rule not found.');
    }

    if (!earnRule.isActive) {
      throw new AppError(400, 'earn_rule_inactive', 'Earn rule is not active.');
    }

    if (earnRule.merchantId !== merchantId) {
      throw new AppError(403, 'earn_rule_merchant_mismatch', 'Earn rule does not belong to this merchant.');
    }

    // Evaluate spend threshold
    if (transactionAmount < earnRule.spendThreshold) {
      throw new AppError(400, 'below_spend_threshold',
        `Transaction amount $${transactionAmount} is below the earn rule threshold of $${earnRule.spendThreshold}.`
      );
    }

    // Ensure wallet exists (create if first mint for customer)
    let walletCreated = false;
    const existingWallet = await prisma.wallet.findUnique({
      where: { customerId },
    });

    if (!existingWallet) {
      await prisma.wallet.create({
        data: { customerId },
      });
      walletCreated = true;

      emitEvent(EventType.WALLET_CREATED, { customerId });
    }

    // Calculate expiry
    const expiryAt = new Date();
    expiryAt.setDate(expiryAt.getDate() + earnRule.expiryDays);

    // Generate token ID for signing
    const tokenId = require('uuid').v4();

    // Sign the token
    const signature = signToken({
      tokenId,
      merchantId,
      customerId,
      denomination: earnRule.tokenDenomination,
      expiryAt: expiryAt.toISOString(),
      isSandbox,
    });

    // Create the token
    const token = await prisma.token.create({
      data: {
        id: tokenId,
        merchantId,
        customerId,
        earnRuleId,
        denomination: earnRule.tokenDenomination,
        tokenType: 'loyalty',
        status: TokenStatus.ACTIVE,
        signature,
        idempotencyKey,
        categoryRestriction: earnRule.categoryRestriction,
        channelRestriction: earnRule.channelRestriction,
        stackabilityFlag: earnRule.stackabilityFlag,
        agentPresentableFlag: earnRule.agentPresentableFlag,
        minimumTransactionFloor: earnRule.minimumTransactionFloor,
        expiryAt,
        isSandbox,
      },
    });

    // Invalidate wallet cache
    await this.invalidateWalletCache(customerId);

    // Emit event
    emitEvent(EventType.TOKEN_MINTED, {
      tokenId: token.id,
      merchantId,
      customerId,
      denomination: token.denomination,
      earnRuleId,
    });

    logger.info({
      tokenId: token.id,
      merchantId,
      customerId,
      denomination: token.denomination,
    }, 'Token minted');

    return {
      token: this.mapToken(token),
      walletCreated,
    };
  }

  /**
   * Get a token by ID.
   */
  async getById(tokenId: string): Promise<ReturnType<typeof this.mapToken> | null> {
    const token = await prisma.token.findUnique({
      where: { id: tokenId },
    });

    return token ? this.mapToken(token) : null;
  }

  /**
   * Invalidate the wallet cache for a customer.
   */
  private async invalidateWalletCache(customerId: string): Promise<void> {
    try {
      const pattern = `wallet:${customerId}:*`;
      const keys = await redis.keys(pattern);
      if (keys.length > 0) {
        await redis.del(...keys);
      }
    } catch (err) {
      logger.warn({ err, customerId }, 'Failed to invalidate wallet cache');
    }
  }

  /**
   * Map Prisma token to API response type.
   */
  private mapToken(token: {
    id: string;
    merchantId: string;
    customerId: string;
    earnRuleId: string;
    denomination: number;
    tokenType: string;
    status: string;
    signature: string;
    idempotencyKey: string;
    categoryRestriction: string | null;
    channelRestriction: string | null;
    stackabilityFlag: boolean;
    agentPresentableFlag: boolean;
    minimumTransactionFloor: number;
    issuedAt: Date;
    expiryAt: Date;
    redeemedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
    isSandbox: boolean;
  }) {
    return {
      id: token.id,
      merchantId: token.merchantId,
      customerId: token.customerId,
      earnRuleId: token.earnRuleId,
      denomination: token.denomination,
      tokenType: token.tokenType,
      status: token.status,
      signature: token.signature,
      idempotencyKey: token.idempotencyKey,
      categoryRestriction: token.categoryRestriction,
      channelRestriction: token.channelRestriction,
      stackabilityFlag: token.stackabilityFlag,
      agentPresentableFlag: token.agentPresentableFlag,
      minimumTransactionFloor: token.minimumTransactionFloor,
      issuedAt: token.issuedAt,
      expiryAt: token.expiryAt,
      redeemedAt: token.redeemedAt,
      createdAt: token.createdAt,
      updatedAt: token.updatedAt,
      isSandbox: token.isSandbox,
    };
  }
}

export const tokenService = new TokenService();
