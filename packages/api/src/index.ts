// ============================================================
// Tokento — API Server Entry Point
// ============================================================
import './config/env';
import fs from 'fs';
import path from 'path';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import * as Sentry from '@sentry/node';
import { API_PREFIX } from '@tokento/shared';
import { logger } from './utils/logger';
import prisma from './db/client';
import { startExpirySweeper } from './jobs/expiry-sweeper';
import { startWebhookRetryWorker } from './jobs/webhook-retry';
import redis from './db/redis';
import { requestId } from './middleware/request-id.middleware';
import { auditLog } from './middleware/audit.middleware';
import { errorHandler, notFoundHandler } from './middleware/error.middleware';

// Routes
import tokenRoutes from './routes/token.routes';
import walletRoutes from './routes/wallet.routes';
import validationRoutes from './routes/validation.routes';
import redemptionRoutes from './routes/redemption.routes';
import merchantRoutes from './routes/merchant.routes';
import eventsRoutes from './routes/events.routes';
import authRoutes from './routes/auth.routes';

// Initialize webhook service (sets up event listeners)
import './services/webhook.service';

import { usingPlaceholderB2BConfig, usingPlaceholderB2CConfig } from './services/stytch.service';

// Placeholder Stytch credentials enable the dev-session token path, which lets a caller
// name its own principal. Refuse to boot rather than serve production traffic that way.
if (process.env.NODE_ENV === 'production' && (usingPlaceholderB2CConfig() || usingPlaceholderB2BConfig())) {
  throw new Error(
    'Refusing to start: placeholder Stytch credentials in production. Set STYTCH_PROJECT_ID/STYTCH_SECRET and STYTCH_B2B_PROJECT_ID/STYTCH_B2B_SECRET.',
  );
}

Sentry.init({
  dsn: process.env.SENTRY_DSN || undefined,
  environment: process.env.NODE_ENV || 'development',
  enabled: Boolean(process.env.SENTRY_DSN),
  tracesSampleRate: 0,
});

const app = express();
const PORT = process.env.PORT || 4000;
const OPENAPI_PATH = path.resolve(__dirname, '../openapi.yaml');
const REDOC_PATH = path.resolve(__dirname, '../docs.html');

// ---- Global Middleware ----
app.use(helmet());
// Required for req.ip to reflect X-Forwarded-For behind a load balancer; without it
// every caller shares one rate-limit bucket.
app.set('trust proxy', 1);

// A payments-adjacent API must not answer every origin. Allowlist only.
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '')
  .split(',').map((o) => o.trim()).filter(Boolean);
app.use(cors({
  origin(origin, callback) {
    // Same-origin/server-to-server requests carry no Origin header.
    if (!origin) return callback(null, true);
    if (ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
    if (ALLOWED_ORIGINS.length === 0 && process.env.NODE_ENV !== 'production') {
      return callback(null, true);
    }
    return callback(new Error('origin_not_allowed'));
  },
  credentials: true,
}));
app.use(express.json({ limit: '1mb' }));
app.use(requestId());
app.use(auditLog());

// A deployed demo mints and redeems value on the open internet. DEMO_READONLY
// freezes both without a redeploy, so an incident can be stopped in seconds.
app.use((req, res, next) => {
  if (process.env.DEMO_READONLY !== 'true') return next();
  const isWrite = req.method === 'POST' || req.method === 'PUT' ||
                  req.method === 'PATCH' || req.method === 'DELETE';
  if (!isWrite) return next();
  res.status(503).json({
    error: {
      code: 'demo_readonly',
      message: 'This deployment is in read-only demo mode; write operations are disabled.',
    },
    requestId: req.requestId || 'unknown',
  });
});

// ---- Health Check ----
/**
 * A dependency probe must never outlive the load balancer's own timeout — an
 * unbounded check hangs instead of reporting, which reads as a network failure
 * rather than an unhealthy instance. ioredis in particular retries internally
 * and will not reject promptly on its own.
 */
function withTimeout<T>(operation: Promise<T>, ms = 2000): Promise<T> {
  return Promise.race([
    operation,
    new Promise<T>((_resolve, reject) =>
      setTimeout(() => reject(new Error('health_check_timeout')), ms).unref()),
  ]);
}

app.get('/health', async (_req, res) => {
  // Checks dependencies rather than returning ok unconditionally, so a load balancer
  // stops routing to an instance whose database or cache is gone.
  const checks = { database: false, cache: false };
  try { await withTimeout(prisma.$queryRaw`SELECT 1`); checks.database = true; } catch { /* reported below */ }
  try { await withTimeout(redis.ping()); checks.cache = true; } catch { /* reported below */ }

  const healthy = checks.database && checks.cache;
  res.status(healthy ? 200 : 503).json({
    status: healthy ? 'ok' : 'degraded',
    service: 'tokento-api',
    checks,
    timestamp: new Date().toISOString(),
  });
});

app.get('/docs/openapi.yaml', (_req, res) => {
  if (!fs.existsSync(OPENAPI_PATH)) {
    res.status(404).json({
      error: {
        code: 'openapi_not_found',
        message: 'openapi.yaml not found. Run `pnpm --filter @tokento/api docs:build`.',
      },
      requestId: 'docs-openapi',
    });
    return;
  }
  res.sendFile(OPENAPI_PATH);
});

app.get('/docs', (_req, res) => {
  if (!fs.existsSync(REDOC_PATH)) {
    res.status(404).json({
      error: {
        code: 'docs_not_found',
        message: 'docs.html not found. Run `pnpm --filter @tokento/api docs:build`.',
      },
      requestId: 'docs-html',
    });
    return;
  }
  res.sendFile(REDOC_PATH);
});

// ---- API Routes ----
app.use(`${API_PREFIX}/tokens`, tokenRoutes);
app.use(`${API_PREFIX}/wallet`, walletRoutes);
app.use(`${API_PREFIX}/tokens`, validationRoutes);
app.use(`${API_PREFIX}/tokens`, redemptionRoutes);
app.use(`${API_PREFIX}/redemptions`, redemptionRoutes);
app.use(`${API_PREFIX}/merchants`, merchantRoutes);
app.use(`${API_PREFIX}/events`, eventsRoutes);
app.use(`${API_PREFIX}/auth`, authRoutes);

// ---- Error Handling ----
app.use(notFoundHandler());
app.use(errorHandler());

// ---- Start Server ----
const server = app.listen(PORT, () => {
  logger.info({ port: PORT, env: process.env.NODE_ENV || 'development' }, `Tokento API server running on port ${PORT}`);
  // Started only once the port is actually bound — otherwise a failed bind leaves
  // background jobs running in a process that is about to die.
  // Nothing else emits token.expired, and without this expiry is only a query-time
  // filter, so expired tokens linger as ACTIVE and inflate liability reports.
  startExpirySweeper();
  startWebhookRetryWorker();
});

// Without this, every deploy drops in-flight audit writes, idempotency records and
// webhook dispatches mid-request.
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    logger.info({ signal }, 'Shutting down, draining connections');
    server.close(() => {
      logger.info('Server closed');
      process.exit(0);
    });
    setTimeout(() => {
      logger.warn('Drain timeout exceeded, forcing exit');
      process.exit(1);
    }, 10_000).unref();
  });
}

export default app;
