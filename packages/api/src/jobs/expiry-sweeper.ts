// ============================================================
// Tokento — Token Expiry Sweeper
// ============================================================
// Expiry was enforced only by a query-time filter, so a token nobody validated
// stayed ACTIVE in the database forever past expiryAt. Two consequences:
// merchant liability reports counted expired tokens as outstanding, and the
// token.expired event — defined, subscribed by the webhook service and the SSE
// stream, and advertised in the dashboard — was never emitted by anything.

import prisma from '../db/client';
import redis from '../db/redis';
import { logger } from '../utils/logger';
import { emitEvent } from '../events/emitter';
import { EventType, TokenStatus } from '@tokento/shared';
import { toMoneyNumber } from '../utils/money';
import { invalidateWalletCache } from '../utils/wallet-cache';

const SWEEP_LOCK_KEY = 'jobs:expiry-sweeper:lock';
const BATCH_SIZE = 500;

export interface SweepResult {
  expired: number;
  skipped: boolean;
}

/**
 * Expire tokens whose expiryAt has passed, emitting one event per token.
 *
 * Guarded by a short-lived Redis lock so that with several API instances running
 * only one sweeps a given tick — otherwise every instance emits a duplicate
 * token.expired for the same token and merchants receive N webhooks.
 */
export async function sweepExpiredTokens(lockTtlSeconds = 50): Promise<SweepResult> {
  let holdsLock = false;
  try {
    const acquired = await redis.set(SWEEP_LOCK_KEY, String(process.pid), 'EX', lockTtlSeconds, 'NX');
    holdsLock = acquired === 'OK';
  } catch (err) {
    // Without a lock we cannot rule out a duplicate sweep, and duplicate webhooks
    // are worse than a late sweep. Skip this tick.
    logger.warn({ err }, 'Expiry sweeper: lock unavailable, skipping tick');
    return { expired: 0, skipped: true };
  }

  if (!holdsLock) return { expired: 0, skipped: true };

  try {
    const now = new Date();
    const due = await prisma.token.findMany({
      where: { status: TokenStatus.ACTIVE, expiryAt: { lt: now } },
      take: BATCH_SIZE,
      select: {
        id: true, merchantId: true, customerId: true,
        denomination: true, expiryAt: true, isSandbox: true,
      },
    });

    if (due.length === 0) return { expired: 0, skipped: false };  // finally releases the lock

    // Filter by id AND status so a token redeemed between the read and the write
    // is not clobbered into EXPIRED.
    const { count } = await prisma.token.updateMany({
      where: { id: { in: due.map((t) => t.id) }, status: TokenStatus.ACTIVE },
      data: { status: TokenStatus.EXPIRED },
    });

    for (const token of due) {
      emitEvent(EventType.TOKEN_EXPIRED, {
        tokenId: token.id,
        merchantId: token.merchantId,
        customerId: token.customerId,
        denomination: toMoneyNumber(token.denomination),
        expiryAt: token.expiryAt.toISOString(),
        isSandbox: token.isSandbox,
      });
    }

    // Expired tokens must disappear from wallet queries immediately.
    const customerIds = [...new Set(due.map((t) => t.customerId))];
    for (const customerId of customerIds) {
      await invalidateWalletCache(customerId);
    }

    logger.info({ count }, 'Expiry sweeper: tokens expired');
    return { expired: count, skipped: false };
  } catch (err) {
    logger.error({ err }, 'Expiry sweeper failed');
    return { expired: 0, skipped: false };
  } finally {
    // Release rather than waiting out the TTL; see webhook-retry for rationale.
    await redis.del(SWEEP_LOCK_KEY).catch(() => {});
  }
}

export function startExpirySweeper(intervalMs = Number(process.env.EXPIRY_SWEEP_INTERVAL_MS) || 60_000) {
  const timer = setInterval(() => { void sweepExpiredTokens(); }, intervalMs);
  timer.unref();
  logger.info({ intervalMs }, 'Expiry sweeper started');
  return timer;
}
