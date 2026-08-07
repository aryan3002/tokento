// ============================================================
// Tokento — Redemption Routes
// ============================================================
import { Router, Request, Response, NextFunction } from 'express';
import { redemptionService } from '../services/redemption.service';
import { authenticateBearerToken, authenticateApiKey } from '../middleware/auth.middleware';
import { rateLimit } from '../middleware/rate-limit.middleware';
import { idempotency } from '../middleware/idempotency.middleware';
import { requireSandboxContext } from '../middleware/sandbox.middleware';
import { RedeemTokenSchema, PaginationSchema } from '@tokento/shared';

const router = Router();

// POST /v1/tokens/:id/redeem
router.post('/:id/redeem',
  authenticateBearerToken(),
  // Agents (and the MCP adapter) send idempotencyKey in the body, but the middleware
  // reads only the header — so MCP redemptions had no idempotency protection at all.
  // Promote a body key into the header so one code path serves both.
  (req: Request, _res: Response, next: NextFunction) => {
    if (!req.headers['idempotency-key'] && typeof req.body?.idempotencyKey === 'string') {
      req.headers['idempotency-key'] = req.body.idempotencyKey;
    }
    next();
  },
  rateLimit('REDEEM'),
  idempotency(),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = RedeemTokenSchema.parse(req.body);
      const tokenId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const result = await redemptionService.redeem(tokenId, data, {
        isSandbox: requireSandboxContext(req),
        authenticatedCustomerId: req.customerId!,
      });
      res.json(result);
    } catch (err) { next(err); }
  }
);

// GET /v1/redemptions — Merchant redemption history
router.get('/',
  authenticateApiKey(['tokens:read']),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { page, limit } = PaginationSchema.parse(req.query);
      const result = await redemptionService.getByMerchant(req.merchantId!, page, limit);
      res.json(result);
    } catch (err) { next(err); }
  }
);

export default router;
