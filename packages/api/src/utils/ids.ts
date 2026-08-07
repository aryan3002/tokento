// ============================================================
// Tokento — ID Generation
// ============================================================

import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';
import { API_KEY } from '@tokento/shared';

/**
 * Generate a UUID v4.
 */
export function generateId(): string {
  return uuidv4();
}

/**
 * Generate an API key.
 * Returns { rawKey, keyPrefix, keyHash }
 * rawKey is shown to the merchant once, then discarded.
 * keyHash is stored in the database.
 */
export function generateApiKey(): {
  rawKey: string;
  keyPrefix: string;
  keyHash: string;
} {
  const rawKey = `tk_${crypto.randomBytes(API_KEY.KEY_LENGTH).toString('base64url')}`;
  const keyPrefix = rawKey.substring(0, API_KEY.PREFIX_LENGTH);
  const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');

  return { rawKey, keyPrefix, keyHash };
}

/**
 * Hash an API key for lookup.
 */
export function hashApiKey(rawKey: string): string {
  return crypto.createHash('sha256').update(rawKey).digest('hex');
}

/**
 * Generate a settlement reference.
 */
/**
 * Correlation id for a redemption. NOT a payment reference: settlement is not
 * implemented, nothing consumes this value, and no funds move.
 */
export function generateSettlementRef(): string {
  return `stl_${crypto.randomBytes(16).toString('hex')}`;
}
