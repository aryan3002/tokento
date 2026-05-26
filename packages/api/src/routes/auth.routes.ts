import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import {
  authenticateB2BSessionJwt,
  authenticateB2CSessionJwt,
  createDevB2BSessionJwt,
  usingPlaceholderStytchConfig,
} from '../services/stytch.service';

const router = Router();

const SessionJwtSchema = z.object({
  sessionJwt: z.string().min(1),
});

router.post('/b2b/authenticate', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { sessionJwt } = SessionJwtSchema.parse(req.body);
    const auth = await authenticateB2BSessionJwt(sessionJwt);
    res.json(auth);
  } catch (err) {
    next(err);
  }
});

router.post('/b2c/authenticate', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { sessionJwt } = SessionJwtSchema.parse(req.body);
    const auth = await authenticateB2CSessionJwt(sessionJwt);
    res.json(auth);
  } catch (err) {
    next(err);
  }
});

router.get('/b2b/dev-session', async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!usingPlaceholderStytchConfig()) {
      res.status(403).json({
        error: {
          code: 'dev_session_disabled',
          message: 'Dev session endpoint is disabled when real Stytch credentials are configured.',
        },
        requestId: req.requestId || 'unknown',
      });
      return;
    }

    const merchantId = typeof req.query.merchantId === 'string' ? req.query.merchantId : undefined;
    const session = await createDevB2BSessionJwt(merchantId);
    res.json({
      ...session,
      fallback: true,
      warning: 'Using dev fallback session. Real Stytch credentials are required before merge.',
    });
  } catch (err) {
    next(err);
  }
});

export default router;
