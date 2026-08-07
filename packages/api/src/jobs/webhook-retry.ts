// ============================================================
// Tokento — Webhook Retry Worker
// ============================================================
// Drives WebhookService.retryPendingDeliveries on an interval. Without it,
// nextRetryAt was written and indexed but never read, so a failed delivery was
// never re-sent and the configured backoff schedule was dead code.

import redis from '../db/redis';
import { logger } from '../utils/logger';
import { webhookService } from '../services/webhook.service';

const RETRY_LOCK_KEY = 'jobs:webhook-retry:lock';

export async function runWebhookRetries(lockTtlSeconds = 25): Promise<{ retried: number; skipped: boolean }> {
  let holdsLock = false;
  try {
    const acquired = await redis.set(RETRY_LOCK_KEY, String(process.pid), 'EX', lockTtlSeconds, 'NX');
    holdsLock = acquired === 'OK';
  } catch (err) {
    logger.warn({ err }, 'Webhook retry: lock unavailable, skipping tick');
    return { retried: 0, skipped: true };
  }

  if (!holdsLock) return { retried: 0, skipped: true };

  try {
    const { retried } = await webhookService.retryPendingDeliveries();
    return { retried, skipped: false };
  } catch (err) {
    logger.error({ err }, 'Webhook retry worker failed');
    return { retried: 0, skipped: false };
  } finally {
    // Release rather than waiting out the TTL. The TTL exists only so a crashed
    // worker cannot hold the lock forever; holding it for the full window would
    // throttle the job to one run per TTL regardless of the configured interval.
    await redis.del(RETRY_LOCK_KEY).catch(() => {});
  }
}

export function startWebhookRetryWorker(
  intervalMs = Number(process.env.WEBHOOK_RETRY_INTERVAL_MS) || 30_000,
) {
  const timer = setInterval(() => { void runWebhookRetries(); }, intervalMs);
  timer.unref();
  logger.info({ intervalMs }, 'Webhook retry worker started');
  return timer;
}
