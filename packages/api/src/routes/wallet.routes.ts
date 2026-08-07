// ============================================================
// Tokento — Wallet Routes (TQI)
// ============================================================
import { Router, Request, Response, NextFunction } from 'express';
import { walletService } from '../services/wallet.service';
import { authenticateBearerToken } from '../middleware/auth.middleware';
import { rateLimit } from '../middleware/rate-limit.middleware';
import { requireSandboxContext } from '../middleware/sandbox.middleware';
import { WalletQuerySchema } from '@tokento/shared';

const router = Router();

// GET /v1/wallet/:customerId/tokens — TQI query endpoint
router.get('/:customerId/tokens',
  authenticateBearerToken(),
  rateLimit('QUERY'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { customerId } = req.params;
      // Ensure customer can only access own wallet
      if (customerId !== req.customerId) {
        res.status(403).json({
          error: { code: 'forbidden', message: 'Cannot access another customer\'s wallet.' },
          requestId: req.requestId,
        });
        return;
      }
      const params = WalletQuerySchema.parse(req.query);
      const result = await walletService.queryTokens(customerId, params, requireSandboxContext(req));
      res.json(result);
    } catch (err) { next(err); }
  }
);

export default router;
