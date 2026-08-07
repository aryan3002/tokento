// ============================================================
// Tokento — Wallet Service
// ============================================================
// GET /v1/wallet/{customer_id}/tokens — TQI query endpoint
// P0: ≤100ms p99, OAuth 2.0 bearer token required
// Redis-cached with 60s TTL, invalidated on mint/redeem

import prisma from '../db/client';
import redis from '../db/redis';
import { logger } from '../utils/logger';
import { Prisma } from '@prisma/client';
import { CACHE_TTL, TokenType, TokenStatus, WalletQueryParams, WalletQueryResponse } from '@tokento/shared';

export class WalletService {
  /**
   * Query a customer's wallet for active, non-expired tokens.
   * Supports filters: merchantId, category, channel, tokenType, minDenomination.
   * Redis-cached with 60s TTL.
   */
  async queryTokens(
    customerId: string,
    params: WalletQueryParams,
    isSandbox: boolean
  ): Promise<WalletQueryResponse> {
    // Build cache key from query params
    const cacheKey = this.buildCacheKey(customerId, params, isSandbox);

    // Check cache first
    try {
      const cached = await redis.get(cacheKey);
      if (cached) {
        logger.debug({ customerId, cacheKey }, 'Wallet query — cache hit');
        return JSON.parse(cached);
      }
    } catch (err: unknown) {
      logger.warn({ err }, 'Redis cache read failed — querying DB');
    }

    // Build Prisma query
    const where: Prisma.TokenWhereInput = {
      customerId,
      status: TokenStatus.ACTIVE,
      expiryAt: { gt: new Date() },       // Not expired
      agentPresentableFlag: true,          // Only agent-presentable tokens
    };

    where.isSandbox = isSandbox;

    if (params.merchantId) {
      where.merchantId = params.merchantId;
    }

    if (params.category) {
      where.OR = [
        { categoryRestriction: null },     // No restriction
        { categoryRestriction: params.category },
      ];
    }

    if (params.channel) {
      where.OR = [
        ...(Array.isArray(where.OR) ? where.OR : []),
        { channelRestriction: null },
        { channelRestriction: params.channel },
      ];
    }

    if (params.tokenType) {
      where.tokenType = params.tokenType;
    }

    if (params.minDenomination) {
      where.denomination = { gte: params.minDenomination };
    }

    const tokens = await prisma.token.findMany({
      where,
      orderBy: [
        { denomination: 'desc' },
        { expiryAt: 'asc' },
      ],
    });

    const totalValue = tokens.reduce((sum: number, t) => sum + t.denomination, 0);

    const response: WalletQueryResponse = {
      customerId,
      tokens: tokens.map((t): WalletQueryResponse['tokens'][number] => ({
        id: t.id,
        merchantId: t.merchantId,
        customerId: t.customerId,
        earnRuleId: t.earnRuleId,
        denomination: t.denomination,
        tokenType: t.tokenType as TokenType,
        status: t.status as TokenStatus,
        signature: t.signature,
        idempotencyKey: t.idempotencyKey,
        categoryRestriction: t.categoryRestriction,
        channelRestriction: t.channelRestriction,
        stackabilityFlag: t.stackabilityFlag,
        agentPresentableFlag: t.agentPresentableFlag,
        minimumTransactionFloor: t.minimumTransactionFloor,
        issuedAt: t.issuedAt,
        expiryAt: t.expiryAt,
        redeemedAt: t.redeemedAt,
        createdAt: t.createdAt,
        updatedAt: t.updatedAt,
        isSandbox: t.isSandbox,
      })),
      totalValue,
    };

    // Cache the response
    try {
      await redis.setex(cacheKey, CACHE_TTL.WALLET_QUERY, JSON.stringify(response));
    } catch (err: unknown) {
      logger.warn({ err }, 'Redis cache write failed');
    }

    return response;
  }

  /**
   * Check if a wallet exists for a customer.
   */
  async walletExists(customerId: string): Promise<boolean> {
    const wallet = await prisma.wallet.findUnique({
      where: { customerId },
    });
    return !!wallet;
  }

  /**
   * Build a cache key for wallet queries.
   */
  private buildCacheKey(customerId: string, params: WalletQueryParams, isSandbox: boolean): string {
    // The environment segment keeps sandbox and production results in separate entries —
    // without it a sandbox query serves its results to a production caller.
    // The `q` segment guarantees every key matches the `wallet:{customerId}:*` pattern used
    // for invalidation on mint and redeem, including the no-filter query. Previously an
    // unfiltered query produced the bare key `wallet:{customerId}`, which that pattern does
    // not match, so the most common query was never invalidated and served stale tokens.
    const parts = [`wallet:${customerId}`, isSandbox ? 'sandbox' : 'production', 'q'];
    if (params.merchantId) parts.push(`m:${params.merchantId}`);
    if (params.category) parts.push(`cat:${params.category}`);
    if (params.channel) parts.push(`ch:${params.channel}`);
    if (params.tokenType) parts.push(`tt:${params.tokenType}`);
    if (params.minDenomination) parts.push(`min:${params.minDenomination}`);
    return parts.join(':');
  }
}

export const walletService = new WalletService();
