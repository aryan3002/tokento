// ============================================================
// Tokento — Merchant Config Service
// ============================================================
import prisma from '../db/client';
import { logger } from '../utils/logger';
import { emitEvent } from '../events/emitter';
import { generateApiKey } from '../utils/ids';
import { EventType, ALL_SCOPES } from '@tokento/shared';
import { AppError } from '../middleware/error.middleware';

export class MerchantService {
  async create(data: { name: string; email: string; settlementType?: string; settlementTiming?: string }) {
    const existing = await prisma.merchant.findUnique({ where: { email: data.email } });
    if (existing) throw new AppError(409, 'merchant_exists', 'A merchant with this email already exists.');

    const merchant = await prisma.merchant.create({
      data: {
        name: data.name,
        email: data.email,
        agentOptIn: true,
        settlementType: data.settlementType || 'discount',
        settlementTiming: data.settlementTiming || 'real_time',
        isSandbox: true,
      },
    });

    // Generate initial API key
    const { rawKey, keyPrefix, keyHash } = generateApiKey();
    await prisma.apiKey.create({
      data: {
        merchantId: merchant.id,
        keyPrefix,
        keyHash,
        scopes: [...ALL_SCOPES],
        rateLimit: 60,
        isSandbox: true,
      },
    });

    emitEvent(EventType.MERCHANT_CREATED, { merchantId: merchant.id, name: merchant.name });
    logger.info({ merchantId: merchant.id, name: merchant.name }, 'Merchant created');

    return { merchant, apiKey: rawKey };
  }

  async getById(merchantId: string) {
    const merchant = await prisma.merchant.findUnique({ where: { id: merchantId } });
    if (!merchant) throw new AppError(404, 'merchant_not_found', 'Merchant not found.');
    return merchant;
  }

  async updateConfig(merchantId: string, data: { agentOptIn?: boolean; settlementType?: string; settlementTiming?: string; webhookUrl?: string | null }) {
    const merchant = await prisma.merchant.update({ where: { id: merchantId }, data });
    return merchant;
  }

  // ---- Earn Rules ----
  async createEarnRule(merchantId: string, data: {
    name: string; spendThreshold: number; tokenDenomination: number; expiryDays?: number;
    categoryRestriction?: string | null; channelRestriction?: string | null;
    stackabilityFlag?: boolean; agentPresentableFlag?: boolean; minimumTransactionFloor?: number;
  }) {
    const rule = await prisma.earnRule.create({
      data: {
        merchantId,
        name: data.name,
        spendThreshold: data.spendThreshold,
        tokenDenomination: data.tokenDenomination,
        expiryDays: data.expiryDays || 90,
        categoryRestriction: data.categoryRestriction || null,
        channelRestriction: data.channelRestriction || null,
        stackabilityFlag: data.stackabilityFlag ?? true,
        agentPresentableFlag: data.agentPresentableFlag ?? true,
        minimumTransactionFloor: data.minimumTransactionFloor || 0,
      },
    });
    emitEvent(EventType.EARN_RULE_CREATED, { earnRuleId: rule.id, merchantId });
    return rule;
  }

  async getEarnRules(merchantId: string) {
    return prisma.earnRule.findMany({ where: { merchantId }, orderBy: { createdAt: 'desc' } });
  }

  async updateEarnRule(merchantId: string, ruleId: string, data: Record<string, unknown>) {
    const rule = await prisma.earnRule.findUnique({ where: { id: ruleId } });
    if (!rule || rule.merchantId !== merchantId) throw new AppError(404, 'earn_rule_not_found', 'Earn rule not found.');
    const updated = await prisma.earnRule.update({ where: { id: ruleId }, data: data as any });
    emitEvent(EventType.EARN_RULE_UPDATED, { earnRuleId: ruleId, merchantId });
    return updated;
  }

  // ---- Tokens & Redemptions ----
  async getTokens(merchantId: string) {
    return prisma.token.findMany({ 
      where: { merchantId }, 
      orderBy: { createdAt: 'desc' },
      take: 100 // limit for MVP
    });
  }

  async getRedemptions(merchantId: string) {
    return prisma.redemption.findMany({ 
      where: { merchantId }, 
      orderBy: { redeemedAt: 'desc' },
      take: 100 // limit for MVP
    });
  }

  // ---- API Keys ----
  async createApiKey(merchantId: string, data: { scopes: string[]; rateLimit?: number; expiresInDays?: number | null }) {
    const { rawKey, keyPrefix, keyHash } = generateApiKey();
    const expiresAt = data.expiresInDays ? new Date(Date.now() + data.expiresInDays * 86400000) : null;
    await prisma.apiKey.create({
      data: { merchantId, keyPrefix, keyHash, scopes: data.scopes, rateLimit: data.rateLimit || 60, isSandbox: true, expiresAt },
    });
    return { apiKey: rawKey, keyPrefix };
  }

  async listApiKeys(merchantId: string) {
    return prisma.apiKey.findMany({
      where: { merchantId },
      select: { id: true, keyPrefix: true, scopes: true, rateLimit: true, isSandbox: true, isActive: true, lastUsedAt: true, createdAt: true, expiresAt: true },
    });
  }

  async revokeApiKey(merchantId: string, keyId: string) {
    const key = await prisma.apiKey.findUnique({ where: { id: keyId } });
    if (!key || key.merchantId !== merchantId) throw new AppError(404, 'api_key_not_found', 'API key not found.');
    await prisma.apiKey.update({ where: { id: keyId }, data: { isActive: false } });
  }
}

export const merchantService = new MerchantService();
