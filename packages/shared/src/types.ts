// ============================================================
// Tokento — Shared Types
// ============================================================
// Canonical type definitions used across API, MCP adapter, and dashboard.
// Maps directly to the Token Architecture in the vault.

// ---- Token Types ----

export enum TokenType {
  LOYALTY = 'loyalty',
  // Phase 2:
  // PRICING = 'pricing',
  // RETURNS = 'returns',
}

export enum TokenStatus {
  ACTIVE = 'ACTIVE',
  REDEEMED = 'REDEEMED',
  EXPIRED = 'EXPIRED',
}

export enum SettlementType {
  DISCOUNT = 'discount',
  CASHBACK = 'cashback',
  CREDIT = 'credit',
}

export enum SettlementTiming {
  REAL_TIME = 'real_time',
  DAILY_BATCH = 'daily_batch',
}

// ---- Token Object ----

export interface Token {
  id: string;
  merchantId: string;
  customerId: string;
  earnRuleId: string;
  denomination: number;          // USD value
  tokenType: TokenType;
  status: TokenStatus;
  signature: string;              // HMAC-SHA256
  idempotencyKey: string;

  // Conditions
  categoryRestriction: string | null;
  channelRestriction: string | null;
  stackabilityFlag: boolean;
  agentPresentableFlag: boolean;
  minimumTransactionFloor: number;

  // Timestamps
  issuedAt: Date;
  expiryAt: Date;
  redeemedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;

  // Environment
  isSandbox: boolean;
}

// ---- Earn Rule ----

export interface EarnRule {
  id: string;
  merchantId: string;
  name: string;
  spendThreshold: number;        // Minimum spend to earn
  tokenDenomination: number;     // Token value awarded
  expiryDays: number;            // Days until token expires
  categoryRestriction: string | null;
  channelRestriction: string | null;
  stackabilityFlag: boolean;
  agentPresentableFlag: boolean; // Default ON per decision log
  minimumTransactionFloor: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

// ---- Merchant ----

export interface Merchant {
  id: string;
  name: string;
  email: string;
  agentOptIn: boolean;
  settlementType: SettlementType;
  settlementTiming: SettlementTiming;
  webhookUrl: string | null;
  webhookSecret: string | null;
  isSandbox: boolean;
  createdAt: Date;
  updatedAt: Date;
}

// ---- API Key ----

export interface ApiKey {
  id: string;
  merchantId: string;
  keyPrefix: string;            // First 8 chars, shown in dashboard
  keyHash: string;              // SHA-256 hash of full key
  scopes: string[];             // e.g., ['tokens:mint', 'tokens:read']
  rateLimit: number;            // Requests per minute
  isSandbox: boolean;
  isActive: boolean;
  lastUsedAt: Date | null;
  createdAt: Date;
  expiresAt: Date | null;
}

// ---- Wallet ----

export interface Wallet {
  customerId: string;
  createdAt: Date;
  updatedAt: Date;
}

// ---- Redemption ----

export interface Redemption {
  id: string;
  tokenId: string;
  merchantId: string;
  customerId: string;
  transactionAmount: number;
  tokenDenomination: number;
  netValue: number;              // transactionAmount - tokenDenomination
  agentId: string | null;        // Which agent initiated redemption
  redeemedAt: Date;
}

// ---- Audit Log ----

export interface AuditLog {
  id: string;
  method: string;
  endpoint: string;
  merchantId: string | null;
  customerId: string | null;
  tokenId: string | null;
  requestBody: Record<string, unknown> | null;
  responseCode: number;
  responseTimeMs: number;
  ipAddress: string | null;
  userAgent: string | null;
  timestamp: Date;
}

// ---- Webhook ----

export interface WebhookEndpoint {
  id: string;
  merchantId: string;
  url: string;
  secret: string;               // For signature verification
  events: string[];             // e.g., ['token.minted', 'token.redeemed']
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface WebhookDelivery {
  id: string;
  webhookEndpointId: string;
  eventType: string;
  payload: Record<string, unknown>;
  responseCode: number | null;
  responseBody: string | null;
  attempts: number;
  nextRetryAt: Date | null;
  deliveredAt: Date | null;
  createdAt: Date;
}

// ---- API Request/Response Types ----

export interface MintTokenRequest {
  merchantId: string;
  customerId: string;
  transactionAmount: number;
  earnRuleId: string;
  idempotencyKey: string;
}

export interface MintTokenResponse {
  token: Token;
  walletCreated: boolean;
}

export interface WalletQueryParams {
  merchantId?: string;
  category?: string;
  channel?: string;
  tokenType?: TokenType;
  minDenomination?: number;
}

export interface WalletQueryResponse {
  customerId: string;
  tokens: Token[];
  totalValue: number;
}

export interface ValidateTokenRequest {
  transactionAmount: number;
  merchantId: string;
  channel?: string;
  agentId?: string;
}

export interface ValidateTokenResponse {
  valid: boolean;
  tokenId: string;
  denomination: number;
  reasonCode: string | null;     // null if valid, detailed reason if not
  reasonMessage: string | null;
}

export interface RedeemTokenRequest {
  transactionAmount: number;
  merchantId: string;
  agentId?: string;
  idempotencyKey: string;
}

export interface RedeemTokenResponse {
  redemptionId: string;
  tokenId: string;
  netTransactionValue: number;
  tokenDenomination: number;
  settlementReference: string;
  alreadyRedeemed: boolean;       // True if idempotent duplicate
}

// ---- Error Response ----

export interface ApiErrorResponse {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
  requestId: string;
}

// ---- Validation Reason Codes ----

export enum ValidationReasonCode {
  TOKEN_EXPIRED = 'token_expired',
  TOKEN_REDEEMED = 'token_redeemed',
  MERCHANT_MISMATCH = 'merchant_mismatch',
  AMOUNT_BELOW_FLOOR = 'amount_below_floor',
  NOT_AGENT_PRESENTABLE = 'not_agent_presentable',
  CHANNEL_MISMATCH = 'channel_mismatch',
  SIGNATURE_INVALID = 'signature_invalid',
  TOKEN_NOT_FOUND = 'token_not_found',
  SANDBOX_PRODUCTION_MISMATCH = 'sandbox_production_mismatch',
}

// ---- Event Types ----

export enum EventType {
  TOKEN_MINTED = 'token.minted',
  TOKEN_REDEEMED = 'token.redeemed',
  TOKEN_EXPIRED = 'token.expired',
  TOKEN_VALIDATED = 'token.validated',
  MERCHANT_CREATED = 'merchant.created',
  EARN_RULE_CREATED = 'earn_rule.created',
  EARN_RULE_UPDATED = 'earn_rule.updated',
  WALLET_CREATED = 'wallet.created',
  WEBHOOK_DELIVERED = 'webhook.delivered',
  WEBHOOK_FAILED = 'webhook.failed',
}
