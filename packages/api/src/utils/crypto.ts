// ============================================================
// Tokento — HMAC Token Signing & Verification
// ============================================================
// Per vault Token Architecture: HMAC-SHA256 with merchant-scoped key.
// Signed at MINT, verified at every VALIDATE and REDEEM (Revision #7).

import crypto from 'crypto';

const MASTER_KEY = process.env.HMAC_MASTER_KEY || 'dev-hmac-master-key-change-me';

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
 * Create an HMAC-SHA256 signature for a token.
 * Signs: tokenId + merchantId + customerId + denomination + expiryAt + isSandbox
 */
export function signToken(params: {
  tokenId: string;
  merchantId: string;
  customerId: string;
  denomination: number;
  expiryAt: string;
  isSandbox: boolean;
}): string {
  const key = deriveMerchantKey(params.merchantId);
  const payload = [
    params.tokenId,
    params.merchantId,
    params.customerId,
    params.denomination.toString(),
    params.expiryAt,
    params.isSandbox ? 'sandbox' : 'production',
  ].join(':');

  return crypto.createHmac('sha256', key).update(payload).digest('hex');
}

/**
 * Verify the HMAC signature of a token.
 * Returns true if the signature matches.
 */
export function verifyTokenSignature(params: {
  tokenId: string;
  merchantId: string;
  customerId: string;
  denomination: number;
  expiryAt: string;
  isSandbox: boolean;
  signature: string;
}): boolean {
  const expectedSignature = signToken({
    tokenId: params.tokenId,
    merchantId: params.merchantId,
    customerId: params.customerId,
    denomination: params.denomination,
    expiryAt: params.expiryAt,
    isSandbox: params.isSandbox,
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
