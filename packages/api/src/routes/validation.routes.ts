// ============================================================
// Tokento — Validation Routes
// ============================================================
import { Router, Request, Response, NextFunction } from 'express';
import { validationService } from '../services/validation.service';
import { authenticateBearerToken } from '../middleware/auth.middleware';
import { rateLimit } from '../middleware/rate-limit.middleware';
import { ValidateTokenSchema } from '@tokento/shared';

const router = Router();

// POST /v1/tokens/:id/validate
router.post('/:id/validate',
  authenticateBearerToken(),
  rateLimit('VALIDATE'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = ValidateTokenSchema.parse(req.body);
      const result = await validationService.validate(req.params.id, data);
      res.json(result);
    } catch (err) { next(err); }
  }
);

export default router;
