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
import { requestId } from './middleware/request-id.middleware';
import { auditLog } from './middleware/audit.middleware';
import { sandboxIsolation } from './middleware/sandbox.middleware';
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
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(requestId());
app.use(auditLog());
app.use(sandboxIsolation());

// ---- Health Check ----
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'tokento-api', timestamp: new Date().toISOString() });
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
app.listen(PORT, () => {
  logger.info({ port: PORT, env: process.env.NODE_ENV || 'development' }, `Tokento API server running on port ${PORT}`);
});

export default app;
