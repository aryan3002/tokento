// ============================================================
// Tokento — Shared Zod Schemas
// ============================================================
// Validation schemas shared between API, MCP adapter, and dashboard.

import { z } from 'zod';
import { TokenType, SettlementType, SettlementTiming } from './types';

// ---- Mint Token ----

export const MintTokenSchema = z.object({
  merchantId: z.string().uuid(),
  customerId: z.string().uuid(),
  transactionAmount: z.number().positive(),
  earnRuleId: z.string().uuid(),
  idempotencyKey: z.string().min(1).max(128),
});

// ---- Wallet Query ----

export const WalletQuerySchema = z.object({
  merchantId: z.string().uuid().optional(),
  category: z.string().optional(),
  channel: z.string().optional(),
  tokenType: z.nativeEnum(TokenType).optional(),
  minDenomination: z.number().positive().optional(),
});

// ---- Validate Token ----

export const ValidateTokenSchema = z.object({
  transactionAmount: z.number().positive(),
  merchantId: z.string().uuid(),
  channel: z.string().optional(),
  agentId: z.string().optional(),
});

// ---- Redeem Token ----

export const RedeemTokenSchema = z.object({
  transactionAmount: z.number().positive(),
  merchantId: z.string().uuid(),
  agentId: z.string().optional(),
  idempotencyKey: z.string().min(1).max(128),
});

// ---- Create Merchant ----

export const CreateMerchantSchema = z.object({
  name: z.string().min(1).max(255),
  email: z.string().email(),
  settlementType: z.nativeEnum(SettlementType).default(SettlementType.DISCOUNT),
  settlementTiming: z.nativeEnum(SettlementTiming).default(SettlementTiming.REAL_TIME),
});

// ---- Update Merchant Config ----

export const UpdateMerchantConfigSchema = z.object({
  agentOptIn: z.boolean().optional(),
  settlementType: z.nativeEnum(SettlementType).optional(),
  settlementTiming: z.nativeEnum(SettlementTiming).optional(),
  webhookUrl: z.string().url().nullable().optional(),
});

// ---- Create Earn Rule ----

export const CreateEarnRuleSchema = z.object({
  name: z.string().min(1).max(255),
  spendThreshold: z.number().nonnegative(),
  tokenDenomination: z.number().positive(),
  expiryDays: z.number().int().positive().default(90),
  categoryRestriction: z.string().nullable().optional(),
  channelRestriction: z.string().nullable().optional(),
  stackabilityFlag: z.boolean().default(true),
  agentPresentableFlag: z.boolean().default(true),
  minimumTransactionFloor: z.number().nonnegative().default(0),
});

// ---- Update Earn Rule ----

export const UpdateEarnRuleSchema = CreateEarnRuleSchema.partial().extend({
  isActive: z.boolean().optional(),
});

// ---- Create Webhook Endpoint ----

export const CreateWebhookEndpointSchema = z.object({
  url: z.string().url(),
  events: z.array(z.string()).min(1),
});

// ---- API Key Creation ----

export const CreateApiKeySchema = z.object({
  scopes: z.array(z.string()).min(1),
  rateLimit: z.number().int().positive().optional(),
  expiresInDays: z.number().int().positive().nullable().optional(),
});

// ---- Pagination ----

export const PaginationSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

// ---- Date Range Filter ----

export const DateRangeSchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});
