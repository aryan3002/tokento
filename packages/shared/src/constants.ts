// ============================================================
// Tokento — Shared Constants
// ============================================================

// ---- Rate Limits (per minute) ----
export const RATE_LIMITS = {
  QUERY: 100,        // Wallet query
  VALIDATE: 20,      // Token validation
  REDEEM: 10,        // Token redemption
  MINT: 50,          // Token minting
  DEFAULT: 60,       // Everything else
} as const;

// ---- Latency Targets (ms, p99) ----
export const LATENCY_TARGETS = {
  MINT: 200,
  WALLET_QUERY: 100,
  VALIDATE: 80,
  REDEEM: 200,
} as const;

// ---- Cache TTLs (seconds) ----
export const CACHE_TTL = {
  WALLET_QUERY: 60,           // 60s wallet query cache
  MERCHANT_CONFIG: 300,       // 5min merchant config cache
  RATE_LIMIT_WINDOW: 60,      // 1 min sliding window
} as const;

// ---- Token Defaults ----
export const TOKEN_DEFAULTS = {
  AGENT_PRESENTABLE_FLAG: true,    // Default ON per Decision Log
  STACKABILITY_FLAG: true,
  MINIMUM_TRANSACTION_FLOOR: 0,
  EXPIRY_DAYS: 90,
} as const;

// ---- Idempotency ----
export const IDEMPOTENCY = {
  KEY_TTL_HOURS: 24,              // 24hr TTL for idempotency records
  HEADER_NAME: 'Idempotency-Key',
} as const;

// ---- API Versioning ----
export const API_VERSION = 'v1';
export const API_PREFIX = `/api/${API_VERSION}`;

// ---- Webhook ----
export const WEBHOOK = {
  MAX_RETRIES: 5,
  RETRY_DELAYS_MS: [1000, 5000, 30000, 120000, 600000],  // 1s, 5s, 30s, 2m, 10m
  TIMEOUT_MS: 10000,           // 10s timeout per delivery attempt
  SIGNATURE_HEADER: 'X-Tokento-Signature',
} as const;

// ---- API Key ----
export const API_KEY = {
  PREFIX_LENGTH: 8,             // First 8 chars shown in dashboard
  KEY_LENGTH: 48,               // Full key length (base64)
  HEADER_NAME: 'X-API-Key',
} as const;

// ---- Audit ----
export const AUDIT = {
  RETENTION_DAYS: 90,           // 90-day minimum per spec
} as const;

// ---- Scopes ----
export const SCOPES = {
  TOKENS_MINT: 'tokens:mint',
  TOKENS_READ: 'tokens:read',
  TOKENS_VALIDATE: 'tokens:validate',
  TOKENS_REDEEM: 'tokens:redeem',
  MERCHANTS_READ: 'merchants:read',
  MERCHANTS_WRITE: 'merchants:write',
  EARN_RULES_READ: 'earn_rules:read',
  EARN_RULES_WRITE: 'earn_rules:write',
  WEBHOOKS_READ: 'webhooks:read',
  WEBHOOKS_WRITE: 'webhooks:write',
  AUDIT_READ: 'audit:read',
} as const;

// All scopes for full-access keys
export const ALL_SCOPES = Object.values(SCOPES);
