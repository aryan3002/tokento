// ============================================================
// Tokento — Webhook Service (Revision #6)
// ============================================================
import prisma from '../db/client';
import { logger } from '../utils/logger';
import { eventBus } from '../events/emitter';
import { generateWebhookSecret, signWebhookPayload } from '../utils/crypto';
import { EventType, WEBHOOK } from '@tokento/shared';
import { AppError } from '../middleware/error.middleware';

export class WebhookService {
  constructor() {
    this.setupEventListeners();
  }

  private setupEventListeners() {
    const deliverableEvents = [EventType.TOKEN_MINTED, EventType.TOKEN_REDEEMED, EventType.TOKEN_EXPIRED];
    for (const eventType of deliverableEvents) {
      eventBus.on(eventType, async (payload: Record<string, unknown>) => {
        try {
          await this.dispatchEvent(eventType, payload);
        } catch (err) {
          logger.error({ err, eventType }, 'Webhook dispatch failed');
        }
      });
    }
  }

  async createEndpoint(merchantId: string, data: { url: string; events: string[] }) {
    const secret = generateWebhookSecret();
    const dedupedEvents = Array.from(new Set(data.events));
    return prisma.webhookEndpoint.create({
      data: { merchantId, url: data.url, secret, events: dedupedEvents },
    });
  }

  async listEndpoints(merchantId: string) {
    return prisma.webhookEndpoint.findMany({ where: { merchantId }, orderBy: { createdAt: 'desc' } });
  }

  async deleteEndpoint(merchantId: string, endpointId: string) {
    const endpoint = await prisma.webhookEndpoint.findUnique({ where: { id: endpointId } });
    if (!endpoint || endpoint.merchantId !== merchantId) throw new AppError(404, 'webhook_not_found', 'Webhook endpoint not found.');
    await prisma.webhookEndpoint.delete({ where: { id: endpointId } });
  }

  async listDeliveries(merchantId: string, options?: { endpointId?: string; limit?: number }) {
    const take = Math.max(1, Math.min(options?.limit ?? 20, 100));
    const deliveries = await prisma.webhookDelivery.findMany({
      where: {
        webhookEndpoint: { merchantId },
        ...(options?.endpointId ? { webhookEndpointId: options.endpointId } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take,
      include: {
        webhookEndpoint: {
          select: {
            id: true,
            url: true,
          },
        },
      },
    });

    return deliveries.map((delivery) => ({
      id: delivery.id,
      webhookEndpointId: delivery.webhookEndpointId,
      endpointUrl: delivery.webhookEndpoint.url,
      eventType: delivery.eventType,
      responseCode: delivery.responseCode,
      responseBody: delivery.responseBody,
      attempts: delivery.attempts,
      retryCount: Math.max(0, delivery.attempts - 1),
      nextRetryAt: delivery.nextRetryAt,
      deliveredAt: delivery.deliveredAt,
      createdAt: delivery.createdAt,
    }));
  }

  private async dispatchEvent(eventType: string, payload: Record<string, unknown>) {
    const merchantId = payload.merchantId as string;
    if (!merchantId) return;

    const endpoints = await prisma.webhookEndpoint.findMany({
      where: { merchantId, isActive: true, events: { has: eventType } },
    });

    for (const endpoint of endpoints) {
      await this.deliver(endpoint.id, endpoint.url, endpoint.secret, eventType, payload);
    }
  }

  private async deliver(endpointId: string, url: string, secret: string, eventType: string, payload: Record<string, unknown>) {
    const delivery = await prisma.webhookDelivery.create({
      data: { webhookEndpointId: endpointId, eventType, payload: payload as object, attempts: 1 },
    });
    await this.attemptDelivery(delivery.id, url, secret, eventType, payload, 1);
  }

  /**
   * Perform one HTTP attempt for an existing delivery row and record the outcome.
   * Shared by the initial dispatch and the retry worker so backoff state is
   * computed in exactly one place.
   */
  async attemptDelivery(
    deliveryId: string,
    url: string,
    secret: string,
    eventType: string,
    payload: Record<string, unknown>,
    attempt: number,
  ) {
    const body = JSON.stringify({ type: eventType, timestamp: new Date().toISOString(), data: payload });
    const signature = signWebhookPayload(secret, body);
    const delivery = { id: deliveryId };

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), WEBHOOK.TIMEOUT_MS);

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          [WEBHOOK.SIGNATURE_HEADER]: signature,
        },
        body,
        signal: controller.signal,
      });

      clearTimeout(timeout);
      const responseBody = await response.text().catch(() => null);

      await prisma.webhookDelivery.update({
        where: { id: delivery.id },
        data: {
          responseCode: response.status,
          responseBody: responseBody ? responseBody.slice(0, 2000) : null,
          attempts: attempt,
          deliveredAt: response.ok ? new Date() : null,
          nextRetryAt: response.ok ? null : this.getNextRetryTime(attempt),
        },
      });

      if (!response.ok) {
        logger.warn({ deliveryId, url, status: response.status, attempt }, 'Webhook delivery failed');
      }
    } catch (err) {
      await prisma.webhookDelivery.update({
        where: { id: delivery.id },
        data: {
          responseBody: err instanceof Error ? err.message : 'webhook_delivery_error',
          attempts: attempt,
          nextRetryAt: this.getNextRetryTime(attempt),
        },
      });
      logger.error({ err, deliveryId, url, attempt }, 'Webhook delivery error');
    }
  }

  /**
   * Re-attempt deliveries whose backoff has elapsed.
   *
   * nextRetryAt was written and indexed but never read by anything — no cron, no
   * worker, no queue — and attempts was pinned at 1, so MAX_RETRIES and the whole
   * backoff schedule were dead config and a failed delivery was never re-sent.
   */
  async retryPendingDeliveries(limit = 100): Promise<{ retried: number }> {
    const due = await prisma.webhookDelivery.findMany({
      where: {
        deliveredAt: null,
        nextRetryAt: { not: null, lte: new Date() },
        attempts: { lt: WEBHOOK.MAX_RETRIES },
      },
      take: limit,
      include: { webhookEndpoint: { select: { url: true, secret: true, isActive: true } } },
    });

    let retried = 0;
    for (const delivery of due) {
      if (!delivery.webhookEndpoint?.isActive) continue;
      // Claim the row first so a second worker cannot pick up the same delivery.
      const claimed = await prisma.webhookDelivery.updateMany({
        where: { id: delivery.id, nextRetryAt: delivery.nextRetryAt },
        data: { nextRetryAt: null },
      });
      if (claimed.count === 0) continue;

      await this.attemptDelivery(
        delivery.id,
        delivery.webhookEndpoint.url,
        delivery.webhookEndpoint.secret,
        delivery.eventType,
        (delivery.payload || {}) as Record<string, unknown>,
        delivery.attempts + 1,
      );
      retried += 1;
    }

    if (retried > 0) logger.info({ retried }, 'Webhook retries dispatched');
    return { retried };
  }

  private getNextRetryTime(attempt: number): Date | null {
    if (attempt >= WEBHOOK.MAX_RETRIES) return null;
    return new Date(Date.now() + WEBHOOK.RETRY_DELAYS_MS[attempt - 1]);
  }
}

export const webhookService = new WebhookService();
