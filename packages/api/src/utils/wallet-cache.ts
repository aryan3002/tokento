// ============================================================
// Tokento — Wallet Cache Index
// ============================================================
// Invalidation used to call redis.keys('wallet:{customerId}:*') on the hot mint
// and redeem paths. KEYS is an O(N) scan of the ENTIRE keyspace that blocks the
// Redis event loop for every other client — unusable on a shared or clustered
// instance, and it degrades as the cache grows rather than with the number of
// keys actually being deleted.
//
// Instead each cached wallet key is recorded in a per-customer Redis Set, so
// invalidation reads that small set and deletes exactly those members.

import redis from '../db/redis';
import { logger } from '../utils/logger';

function indexKey(customerId: string): string {
  return `wallet-index:${customerId}`;
}

/** Record a cache key against its customer so it can be found without a scan. */
export async function trackWalletCacheKey(
  customerId: string,
  cacheKey: string,
  ttlSeconds: number,
): Promise<void> {
  try {
    await redis.sadd(indexKey(customerId), cacheKey);
    // Outlive the entries it points at; stale members are harmless because
    // deleting an already-expired key is a no-op.
    await redis.expire(indexKey(customerId), ttlSeconds * 4);
  } catch (err) {
    logger.warn({ err, customerId }, 'Wallet cache index write failed');
  }
}

/** Delete every cached wallet entry for a customer. */
export async function invalidateWalletCache(customerId: string): Promise<number> {
  try {
    const key = indexKey(customerId);
    const members = await redis.smembers(key);
    if (members.length > 0) {
      await redis.del(...members);
    }
    await redis.del(key);
    return members.length;
  } catch (err) {
    logger.warn({ err, customerId }, 'Wallet cache invalidation failed');
    return 0;
  }
}
