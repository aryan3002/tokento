// ============================================================
// Tokento — API Server Entry Point
// ============================================================
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
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

// Initialize webhook service (sets up event listeners)
import './services/webhook.service';

const app = express();
const PORT = process.env.PORT || 4000;

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

// ---- API Routes ----
app.use(`${API_PREFIX}/tokens`, tokenRoutes);
app.use(`${API_PREFIX}/wallet`, walletRoutes);
app.use(`${API_PREFIX}/tokens`, validationRoutes);
app.use(`${API_PREFIX}/tokens`, redemptionRoutes);
app.use(`${API_PREFIX}/redemptions`, redemptionRoutes);
app.use(`${API_PREFIX}/merchants`, merchantRoutes);
app.use(`${API_PREFIX}/events`, eventsRoutes);

// ---- Error Handling ----
app.use(notFoundHandler());
app.use(errorHandler());

// ---- Start Server ----
app.listen(PORT, () => {
  logger.info({ port: PORT, env: process.env.NODE_ENV || 'development' }, `Tokento API server running on port ${PORT}`);
});

export default app;
