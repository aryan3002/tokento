// ============================================================
// Tokento — HMAC Token Signing & Verification
// ============================================================
// Per vault Token Architecture: HMAC-SHA256 with merchant-scoped key.
// Signed at MINT, verified at every VALIDATE and REDEEM (Revision #7).

import crypto from 'crypto';

// A missing key in production would silently fall back to a publicly-known literal,
// making every token signature forgeable. Fail loudly at load instead.
const MASTER_KEY = ((): string => {
  const key = process.env.HMAC_MASTER_KEY;
  if (key) return key;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('HMAC_MASTER_KEY is required in production.');
  }
  return 'dev-hmac-master-key-change-me';
})();

export interface TokenSignatureParams {
  tokenId: string;
  merchantId: string;
  customerId: string;
  denomination: number;
  expiryAt: string;
  isSandbox: boolean;
  minimumTransactionFloor: number;
  agentPresentableFlag: boolean;
}

/**
 * Derive a merchant-scoped HMAC key from the master key.
 */
function deriveMerchantKey(merchantId: string): Buffer {
  return crypto
    .createHmac('sha256', MASTER_KEY)
    .update(`merchant:${merchantId}`)
    .digest();
}

/**
 * Canonical payload used for token signature generation and verification.
 * Keeping this in one place prevents signing/verification drift.
 */
export function buildTokenSignaturePayload(params: TokenSignatureParams): string {
  return [
    params.tokenId,
    params.merchantId,
    params.customerId,
    params.denomination.toString(),
    params.expiryAt,
    params.isSandbox ? 'sandbox' : 'production',
    // Immutable per-token constraints. Unsigned, a DB-write attacker could lower the
    // spend floor or flip presentability without invalidating the MAC.
    params.minimumTransactionFloor.toString(),
    params.agentPresentableFlag ? 'agent' : 'no-agent',
  ].join(':');
}

/**
 * Create an HMAC-SHA256 signature for a token.
 * Signs: tokenId + merchantId + customerId + denomination + expiryAt + isSandbox
 */
export function signToken(params: TokenSignatureParams): string {
  const key = deriveMerchantKey(params.merchantId);
  const payload = buildTokenSignaturePayload(params);

  return crypto.createHmac('sha256', key).update(payload).digest('hex');
}

/**
 * Verify the HMAC signature of a token.
 * Returns true if the signature matches.
 */
export function verifyTokenSignature(params: TokenSignatureParams & {
  signature: string;
}): boolean {
  const expectedSignature = signToken({
    tokenId: params.tokenId,
    merchantId: params.merchantId,
    customerId: params.customerId,
    denomination: params.denomination,
    expiryAt: params.expiryAt,
    isSandbox: params.isSandbox,
    minimumTransactionFloor: params.minimumTransactionFloor,
    agentPresentableFlag: params.agentPresentableFlag,
  });

  // Constant-time comparison to prevent timing attacks
  return crypto.timingSafeEqual(
    Buffer.from(params.signature, 'hex'),
    Buffer.from(expectedSignature, 'hex')
  );
}

/**
 * Generate a webhook signing secret.
 */
export function generateWebhookSecret(): string {
  return `whsec_${crypto.randomBytes(32).toString('hex')}`;
}

/**
 * Sign a webhook payload for delivery.
 */
export function signWebhookPayload(secret: string, payload: string): string {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}
