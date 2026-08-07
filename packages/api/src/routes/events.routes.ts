// ============================================================
// Tokento — Server-Sent Events Stream
// ============================================================
// GET /v1/events/stream?apiKey=tk_...
//
// Real-time event stream for merchant dashboards and tooling. Replaces the
// dashboard's 3s polling. Subscribes to the in-process event bus, filters by
// merchant, and pushes events as SSE frames with a 15s heartbeat.
//
// Auth: EventSource cannot set custom headers, so the API key is passed as a
// query parameter. Acceptable for dashboard/dev use; production should switch
// to a short-lived token or fetch-based stream (Phase 2).

import { Router, Request, Response } from 'express';
import prisma from '../db/client';
import { hashApiKey } from '../utils/ids';
import { eventBus } from '../events/emitter';
import { EventType } from '@tokento/shared';
import { logger } from '../utils/logger';
import { authenticateB2BSessionJwt } from '../services/stytch.service';

const router = Router();

const STREAMED_EVENTS: EventType[] = [
  EventType.TOKEN_MINTED,
  EventType.TOKEN_REDEEMED,
  EventType.TOKEN_EXPIRED,
  EventType.TOKEN_VALIDATED,
  EventType.EARN_RULE_CREATED,
  EventType.EARN_RULE_UPDATED,
  EventType.WALLET_CREATED,
];

const HEARTBEAT_MS = 15_000;

router.get('/stream', async (req: Request, res: Response) => {
  const rawKey = (req.query.apiKey as string) || (req.headers['x-api-key'] as string);
  const sessionJwt = req.query.sessionJwt as string | undefined;

  if (!rawKey && !sessionJwt) {
    res.status(401).json({ error: { code: 'missing_api_key', message: 'API key required as ?apiKey= or X-API-Key header.' } });
    return;
  }

  let merchantId: string;
  if (sessionJwt) {
    try {
      const auth = await authenticateB2BSessionJwt(sessionJwt);
      merchantId = auth.merchantId;
    } catch (err) {
      logger.warn({ err }, 'Invalid B2B session for SSE stream');
      res.status(401).json({ error: { code: 'invalid_b2b_session', message: 'Invalid B2B session JWT.' } });
      return;
    }
  } else {
    const apiKey = await prisma.apiKey.findUnique({ where: { keyHash: hashApiKey(rawKey!) } });
    if (!apiKey || !apiKey.isActive) {
      res.status(401).json({ error: { code: 'invalid_api_key', message: 'Invalid or deactivated API key.' } });
      return;
    }
    // This route authenticated by hand and skipped the expiry and scope checks the
    // shared middleware performs. Apply them here too.
    if (apiKey.expiresAt && apiKey.expiresAt < new Date()) {
      res.status(401).json({ error: { code: 'expired_api_key', message: 'API key has expired.' } });
      return;
    }
    if (!apiKey.scopes.includes('tokens:read')) {
      res.status(403).json({ error: { code: 'insufficient_scopes', message: 'This API key lacks the tokens:read scope.' } });
      return;
    }
    merchantId = apiKey.merchantId;
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const send = (event: string, data: unknown) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  send('ready', { merchantId, streamedEvents: STREAMED_EVENTS, heartbeatMs: HEARTBEAT_MS });

  const listeners = new Map<EventType, (payload: Record<string, unknown>) => void>();
  for (const eventType of STREAMED_EVENTS) {
    const listener = (payload: Record<string, unknown>) => {
      const payloadMerchant = payload.merchantId as string | undefined;
      // Default to DROP. Broadcasting unscoped events sent customer identifiers to
      // every connected merchant — combined with a customer UUID being enough to read
      // a wallet, that was a live harvesting channel. An event without a merchantId is
      // a bug in the emitter, not a licence to fan it out.
      if (!payloadMerchant) {
        logger.warn({ eventType }, 'Dropping event with no merchantId; cannot scope it to a subscriber');
        return;
      }
      if (payloadMerchant !== merchantId) return;
      send(eventType, payload);
    };
    eventBus.on(eventType, listener);
    listeners.set(eventType, listener);
  }

  const heartbeat = setInterval(() => {
    res.write(`: heartbeat ${Date.now()}\n\n`);
  }, HEARTBEAT_MS);

  const cleanup = () => {
    clearInterval(heartbeat);
    for (const [eventType, listener] of listeners) {
      eventBus.off(eventType, listener);
    }
    logger.debug({ merchantId }, 'SSE stream closed');
  };

  req.on('close', cleanup);
  req.on('end', cleanup);

  logger.debug({ merchantId }, 'SSE stream opened');
});

export default router;
