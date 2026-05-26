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
    return prisma.webhookEndpoint.create({
      data: { merchantId, url: data.url, secret, events: data.events },
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
    const body = JSON.stringify({ type: eventType, timestamp: new Date().toISOString(), data: payload });
    const signature = signWebhookPayload(secret, body);

    const delivery = await prisma.webhookDelivery.create({
      data: { webhookEndpointId: endpointId, eventType, payload: payload as object, attempts: 1 },
    });

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

      await prisma.webhookDelivery.update({
        where: { id: delivery.id },
        data: {
          responseCode: response.status,
          deliveredAt: response.ok ? new Date() : null,
          nextRetryAt: response.ok ? null : this.getNextRetryTime(1),
        },
      });

      if (!response.ok) {
        logger.warn({ endpointId, url, status: response.status }, 'Webhook delivery failed');
      }
    } catch (err) {
      await prisma.webhookDelivery.update({
        where: { id: delivery.id },
        data: { nextRetryAt: this.getNextRetryTime(1) },
      });
      logger.error({ err, endpointId, url }, 'Webhook delivery error');
    }
  }

  private getNextRetryTime(attempt: number): Date | null {
    if (attempt >= WEBHOOK.MAX_RETRIES) return null;
    return new Date(Date.now() + WEBHOOK.RETRY_DELAYS_MS[attempt - 1]);
  }
}

export const webhookService = new WebhookService();
