// ============================================================
// Tokento — Token Routes
// ============================================================
import { Router, Request, Response, NextFunction } from 'express';
import { tokenService } from '../services/token.service';
import { authenticateApiKey } from '../middleware/auth.middleware';
import { rateLimit } from '../middleware/rate-limit.middleware';
import { idempotency } from '../middleware/idempotency.middleware';
import { MintTokenSchema } from '@tokento/shared';

const router = Router();

// POST /v1/tokens/mint
router.post('/mint',
  authenticateApiKey(['tokens:mint']),
  rateLimit('MINT'),
  idempotency(),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = MintTokenSchema.parse(req.body);
      // Ensure merchantId matches authenticated merchant
      if (data.merchantId !== req.merchantId) {
        res.status(403).json({
          error: { code: 'merchant_mismatch', message: 'Cannot mint tokens for another merchant.' },
          requestId: req.requestId,
        });
        return;
      }
      const result = await tokenService.mint(data, req.isSandbox ?? true);
      res.status(201).json(result);
    } catch (err) { next(err); }
  }
);

// GET /v1/tokens/:id
router.get('/:id',
  authenticateApiKey(['tokens:read']),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const token = await tokenService.getById(req.params.id);
      if (!token) {
        res.status(404).json({ error: { code: 'token_not_found', message: 'Token not found.' }, requestId: req.requestId });
        return;
      }
      if (token.merchantId !== req.merchantId) {
        res.status(403).json({ error: { code: 'forbidden', message: 'Cannot access tokens from another merchant.' }, requestId: req.requestId });
        return;
      }
      res.json(token);
    } catch (err) { next(err); }
  }
);

export default router;
