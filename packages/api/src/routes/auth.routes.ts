import crypto from 'crypto';
import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import {
  authenticateB2BSessionJwt,
  authenticateB2CSessionJwt,
  createDevB2BSessionJwt,
  createDevB2CSessionJwt,
  usingPlaceholderStytchConfig,
} from '../services/stytch.service';

const router = Router();
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
const OAUTH_STATE_SIGNING_KEY =
  process.env.WIDGET_STATE_SIGNING_KEY ||
  process.env.HMAC_MASTER_KEY ||
  'dev-widget-state-key-change-me';

const SessionJwtSchema = z.object({
  sessionJwt: z.string().min(1),
});

const WidgetStateRequestSchema = z.object({
  merchantId: z.string().min(1),
  customerId: z.string().min(1),
  origin: z.string().url(),
});

const WidgetAuthorizeQuerySchema = z.object({
  state: z.string().min(1),
  sessionJwt: z.string().min(1).optional(),
});

const WidgetStatePayloadSchema = z.object({
  merchantId: z.string().min(1),
  customerId: z.string().min(1),
  origin: z.string().url(),
  issuedAt: z.number().int().positive(),
  nonce: z.string().min(1),
});

type WidgetStatePayload = z.infer<typeof WidgetStatePayloadSchema>;

function signWidgetState(payload: WidgetStatePayload): string {
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const signature = crypto
    .createHmac('sha256', OAUTH_STATE_SIGNING_KEY)
    .update(encoded)
    .digest('base64url');
  return `${encoded}.${signature}`;
}

function verifyWidgetState(state: string): WidgetStatePayload | null {
  const [encoded, signature] = state.split('.');
  if (!encoded || !signature) {
    return null;
  }

  const expectedSignature = crypto
    .createHmac('sha256', OAUTH_STATE_SIGNING_KEY)
    .update(encoded)
    .digest('base64url');

  if (signature.length !== expectedSignature.length) {
    return null;
  }

  const isValidSignature = crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expectedSignature)
  );
  if (!isValidSignature) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  } catch {
    return null;
  }

  const result = WidgetStatePayloadSchema.safeParse(parsed);
  if (!result.success) {
    return null;
  }

  const ageMs = Date.now() - result.data.issuedAt;
  if (ageMs < -60_000 || ageMs > OAUTH_STATE_TTL_MS) {
    return null;
  }

  return result.data;
}

function buildWidgetGrantHtml(params: {
  title: string;
  subtitle: string;
  targetOrigin: string;
  payload: Record<string, unknown>;
  grantLabel: string;
  cancelLabel: string;
  showGrantButton: boolean;
}): string {
  const payloadJson = JSON.stringify(params.payload).replace(/</g, '\\u003c');
  const targetOriginJson = JSON.stringify(params.targetOrigin);

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>Tokento OAuth</title>
    <style>
      body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#f8fafc;color:#0f172a;margin:0;display:grid;place-items:center;min-height:100vh}
      .card{background:#fff;border:1px solid #e2e8f0;border-radius:14px;box-shadow:0 10px 28px rgba(2,6,23,.08);width:min(92vw,420px);padding:20px}
      h1{font-size:18px;margin:0 0 8px}
      p{font-size:14px;line-height:1.55;color:#475569;margin:0 0 16px}
      .btn{width:100%;padding:10px 14px;border-radius:10px;border:0;cursor:pointer;font-weight:600;font-size:14px}
      .btn-primary{background:#2563eb;color:#fff;margin-bottom:10px}
      .btn-secondary{background:#e2e8f0;color:#0f172a}
    </style>
  </head>
  <body>
    <div class="card">
      <h1>${params.title}</h1>
      <p>${params.subtitle}</p>
      ${params.showGrantButton ? `<button class="btn btn-primary" id="grant">${params.grantLabel}</button>` : ''}
      <button class="btn btn-secondary" id="cancel">${params.cancelLabel}</button>
    </div>
    <script>
      const payload = ${payloadJson};
      const targetOrigin = ${targetOriginJson};
      const postAndClose = (nextPayload) => {
        if (window.opener) {
          window.opener.postMessage(nextPayload, targetOrigin);
        }
        window.close();
      };

      const grantBtn = document.getElementById('grant');
      if (grantBtn) {
        grantBtn.addEventListener('click', () => postAndClose(payload));
      }

      const cancelBtn = document.getElementById('cancel');
      if (cancelBtn) {
        cancelBtn.addEventListener('click', () => {
          postAndClose({
            type: 'tokento_oauth_result',
            state: payload.state,
            error: 'access_denied',
            message: 'User denied access.',
          });
        });
      }
    </script>
  </body>
</html>`;
}

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

router.post('/b2c/widget/state', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { merchantId, customerId, origin } = WidgetStateRequestSchema.parse(req.body);
    const payload: WidgetStatePayload = {
      merchantId,
      customerId,
      origin,
      issuedAt: Date.now(),
      nonce: crypto.randomBytes(16).toString('hex'),
    };

    const state = signWidgetState(payload);
    const host = `${req.protocol}://${req.get('host')}`;
    const authorizeUrl = `${host}/api/v1/auth/b2c/widget/authorize?state=${encodeURIComponent(state)}`;

    res.json({
      state,
      authorizeUrl,
      expiresInSeconds: Math.floor(OAUTH_STATE_TTL_MS / 1000),
    });
  } catch (err) {
    next(err);
  }
});

router.get('/b2c/widget/authorize', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { state, sessionJwt } = WidgetAuthorizeQuerySchema.parse(req.query);
    const payload = verifyWidgetState(state);

    if (!payload) {
      res.status(400).type('html').send(buildWidgetGrantHtml({
        title: 'Invalid OAuth state',
        subtitle: 'This authorization request is invalid or expired. Please restart checkout and try again.',
        targetOrigin: '*',
        payload: {
          type: 'tokento_oauth_result',
          state,
          error: 'invalid_state',
          message: 'OAuth state is invalid or expired.',
        },
        grantLabel: 'Grant access',
        cancelLabel: 'Close',
        showGrantButton: false,
      }));
      return;
    }

    let walletToken: string;
    let fallback = false;

    if (usingPlaceholderStytchConfig()) {
      const devSession = await createDevB2CSessionJwt(payload.customerId);
      walletToken = devSession.sessionJwt;
      fallback = true;
    } else {
      if (!sessionJwt) {
        res.status(400).type('html').send(buildWidgetGrantHtml({
          title: 'Session required',
          subtitle: 'Real Stytch credentials are configured. Pass a valid B2C session JWT to complete authorization.',
          targetOrigin: payload.origin,
          payload: {
            type: 'tokento_oauth_result',
            state,
            error: 'session_required',
            message: 'B2C session JWT required when placeholder credentials are not in use.',
          },
          grantLabel: 'Grant access',
          cancelLabel: 'Close',
          showGrantButton: false,
        }));
        return;
      }

      const auth = await authenticateB2CSessionJwt(sessionJwt);
      if (auth.customerId !== payload.customerId) {
        res.status(400).type('html').send(buildWidgetGrantHtml({
          title: 'Session mismatch',
          subtitle: 'The provided B2C session does not match the checkout customer context.',
          targetOrigin: payload.origin,
          payload: {
            type: 'tokento_oauth_result',
            state,
            error: 'customer_mismatch',
            message: 'B2C session customer does not match checkout customer.',
          },
          grantLabel: 'Grant access',
          cancelLabel: 'Close',
          showGrantButton: false,
        }));
        return;
      }

      walletToken = sessionJwt;
    }

    res.type('html').send(buildWidgetGrantHtml({
      title: 'Authorize Tokento Access',
      subtitle: `Grant AI agent access to customer ${payload.customerId} rewards for merchant ${payload.merchantId}.`,
      targetOrigin: payload.origin,
      payload: {
        type: 'tokento_oauth_result',
        state,
        merchantId: payload.merchantId,
        customerId: payload.customerId,
        walletToken,
        fallback,
      },
      grantLabel: 'Grant access',
      cancelLabel: 'Cancel',
      showGrantButton: true,
    }));
  } catch (err) {
    next(err);
  }
});

export default router;
