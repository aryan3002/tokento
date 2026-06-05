import crypto from 'crypto';
import express, { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import {
  authenticateB2BMagicLink,
  authenticateB2BSessionJwt,
  authenticateB2CMagicLink,
  authenticateB2CSessionJwt,
  createDevB2BSessionJwt,
  createDevB2CSessionJwt,
  resolveDashboardMerchantId,
  sendB2BMagicLink,
  sendB2CMagicLink,
  usingPlaceholderB2BConfig,
  usingPlaceholderB2CConfig,
} from '../services/stytch.service';
import { AppError } from '../middleware/error.middleware';

const router = Router();
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
const OAUTH_STATE_SIGNING_KEY =
  process.env.WIDGET_STATE_SIGNING_KEY ||
  process.env.HMAC_MASTER_KEY ||
  'dev-widget-state-key-change-me';

const SessionJwtSchema = z.object({
  sessionJwt: z.string().min(1),
});

const B2BMagicLinkStartSchema = z.object({
  email: z.string().email(),
  merchantId: z.string().min(1).optional(),
});

const B2BMagicLinkCallbackSchema = z.object({
  state: z.string().min(1),
  token: z.string().min(1),
});

const B2BMagicLinkStatePayloadSchema = z.object({
  email: z.string().email(),
  merchantId: z.string().min(1),
  issuedAt: z.number().int().positive(),
  nonce: z.string().min(1),
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

const WidgetMagicLinkStartSchema = z.object({
  email: z.string().email(),
  state: z.string().min(1),
});

const WidgetMagicLinkCallbackSchema = z.object({
  state: z.string().min(1),
  token: z.string().min(1),
});

const WidgetStatePayloadSchema = z.object({
  merchantId: z.string().min(1),
  customerId: z.string().min(1),
  origin: z.string().url(),
  issuedAt: z.number().int().positive(),
  nonce: z.string().min(1),
});

type WidgetStatePayload = z.infer<typeof WidgetStatePayloadSchema>;
type B2BMagicLinkStatePayload = z.infer<typeof B2BMagicLinkStatePayloadSchema>;

function signEncodedPayload(payload: Record<string, unknown>): string {
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const signature = crypto
    .createHmac('sha256', OAUTH_STATE_SIGNING_KEY)
    .update(encoded)
    .digest('base64url');
  return `${encoded}.${signature}`;
}

function signWidgetState(payload: WidgetStatePayload): string {
  return signEncodedPayload(payload);
}

function signB2BMagicLinkState(payload: B2BMagicLinkStatePayload): string {
  return signEncodedPayload(payload);
}

function verifySignedPayload<T>(
  state: string,
  schema: z.ZodType<T>,
  maxAgeMs: number
): T | null {
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

  const result = schema.safeParse(parsed);
  if (!result.success) {
    return null;
  }

  const data = result.data as T & { issuedAt: number };
  const ageMs = Date.now() - data.issuedAt;
  if (ageMs < -60_000 || ageMs > maxAgeMs) {
    return null;
  }

  return result.data;
}

function verifyWidgetState(state: string): WidgetStatePayload | null {
  return verifySignedPayload(state, WidgetStatePayloadSchema, OAUTH_STATE_TTL_MS);
}

function verifyB2BMagicLinkState(state: string): B2BMagicLinkStatePayload | null {
  return verifySignedPayload(state, B2BMagicLinkStatePayloadSchema, OAUTH_STATE_TTL_MS);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
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
  const title = escapeHtml(params.title);
  const subtitle = escapeHtml(params.subtitle);
  const grantLabel = escapeHtml(params.grantLabel);
  const cancelLabel = escapeHtml(params.cancelLabel);

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
      <h1>${title}</h1>
      <p>${subtitle}</p>
      ${params.showGrantButton ? `<button class="btn btn-primary" id="grant">${grantLabel}</button>` : ''}
      <button class="btn btn-secondary" id="cancel">${cancelLabel}</button>
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

function buildWidgetEmailFormHtml(params: {
  state: string;
  customerId: string;
  merchantId: string;
}): string {
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
      p,label{font-size:14px;line-height:1.55;color:#475569}
      input{width:100%;box-sizing:border-box;padding:10px 12px;border:1px solid #cbd5e1;border-radius:10px;margin:8px 0 14px;font-size:14px}
      .btn{width:100%;padding:10px 14px;border-radius:10px;border:0;cursor:pointer;font-weight:600;font-size:14px;background:#2563eb;color:#fff}
      .meta{font-size:12px;color:#64748b;margin-top:12px}
    </style>
  </head>
  <body>
    <form class="card" method="post" action="/api/v1/auth/b2c/widget/magic-link/start">
      <h1>Authorize Tokento Access</h1>
      <p>Enter your email to receive a Stytch magic link. After you click it, this popup will return a wallet token to checkout.</p>
      <input type="hidden" name="state" value="${escapeHtml(params.state)}" />
      <label for="email">Email</label>
      <input id="email" name="email" type="email" autocomplete="email" required autofocus />
      <button class="btn" type="submit">Send magic link</button>
      <p class="meta">Customer ${escapeHtml(params.customerId)} · Merchant ${escapeHtml(params.merchantId)}</p>
    </form>
  </body>
</html>`;
}

function buildCheckEmailHtml(email: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>Check your email</title>
    <style>
      body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#f8fafc;color:#0f172a;margin:0;display:grid;place-items:center;min-height:100vh}
      .card{background:#fff;border:1px solid #e2e8f0;border-radius:14px;box-shadow:0 10px 28px rgba(2,6,23,.08);width:min(92vw,420px);padding:20px}
      h1{font-size:18px;margin:0 0 8px}
      p{font-size:14px;line-height:1.55;color:#475569}
    </style>
  </head>
  <body>
    <div class="card">
      <h1>Check your email</h1>
      <p>We sent a Stytch magic link to ${escapeHtml(email)}. Click it to finish authorizing wallet access.</p>
    </div>
  </body>
</html>`;
}

router.post('/b2b/magic-link/start', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email, merchantId } = B2BMagicLinkStartSchema.parse(req.body);
    const resolvedMerchantId = await resolveDashboardMerchantId(merchantId);

    if (usingPlaceholderB2BConfig()) {
      const session = await createDevB2BSessionJwt(resolvedMerchantId);
      res.json({
        mode: 'dev',
        sent: false,
        sessionJwt: session.sessionJwt,
        merchantId: session.merchantId,
        fallback: true,
        warning: 'Using dev fallback session. Configure real Stytch B2B credentials for magic-link email delivery.',
      });
      return;
    }

    const state = signB2BMagicLinkState({
      email,
      merchantId: resolvedMerchantId,
      issuedAt: Date.now(),
      nonce: crypto.randomBytes(16).toString('hex'),
    });
    const host = `${req.protocol}://${req.get('host')}`;
    const redirectUrl = `${host}/api/v1/auth/b2b/magic-link/callback?state=${encodeURIComponent(state)}`;
    const result = await sendB2BMagicLink({ email, redirectUrl });

    res.json({
      mode: 'stytch',
      sent: true,
      email,
      merchantId: resolvedMerchantId,
      organizationId: result.organizationId,
    });
  } catch (err) {
    if (err instanceof Error && err.message === 'merchant_not_found') {
      next(new AppError(404, 'merchant_not_found', 'Merchant not found for B2B login.'));
      return;
    }
    if (err instanceof Error && err.message === 'stytch_b2b_organization_missing') {
      next(new AppError(500, 'stytch_b2b_organization_missing', 'STYTCH_B2B_ORGANIZATION_ID is required for B2B magic-link login.'));
      return;
    }
    next(err);
  }
});

router.get('/b2b/magic-link/callback', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { state, token } = B2BMagicLinkCallbackSchema.parse(req.query);
    const payload = verifyB2BMagicLinkState(state);

    if (!payload) {
      throw new AppError(400, 'invalid_state', 'B2B magic-link state is invalid or expired.');
    }

    const session = await authenticateB2BMagicLink({
      magicLinksToken: token,
      merchantId: payload.merchantId,
      sessionDurationMinutes: 60,
    });
    const dashboardBaseUrl = process.env.DASHBOARD_BASE_URL || 'http://localhost:3100';
    const redirectUrl = `${dashboardBaseUrl.replace(/\/+$/, '')}/authenticate#sessionJwt=${encodeURIComponent(session.sessionJwt)}`;

    res.redirect(302, redirectUrl);
  } catch (err) {
    next(err);
  }
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
    if (!usingPlaceholderB2BConfig()) {
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

router.post('/b2c/widget/magic-link/start', express.urlencoded({ extended: false }), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email, state } = WidgetMagicLinkStartSchema.parse(req.body);
    const payload = verifyWidgetState(state);

    if (!payload) {
      throw new AppError(400, 'invalid_state', 'Widget OAuth state is invalid or expired.');
    }

    if (usingPlaceholderB2CConfig()) {
      const devSession = await createDevB2CSessionJwt(payload.customerId);
      res.type('html').send(buildWidgetGrantHtml({
        title: 'Authorize Tokento Access',
        subtitle: `Grant AI agent access to customer ${payload.customerId} rewards for merchant ${payload.merchantId}.`,
        targetOrigin: payload.origin,
        payload: {
          type: 'tokento_oauth_result',
          state,
          merchantId: payload.merchantId,
          customerId: payload.customerId,
          walletToken: devSession.sessionJwt,
          fallback: true,
        },
        grantLabel: 'Grant access',
        cancelLabel: 'Cancel',
        showGrantButton: true,
      }));
      return;
    }

    const host = `${req.protocol}://${req.get('host')}`;
    const redirectUrl = `${host}/api/v1/auth/b2c/widget/magic-link/callback?state=${encodeURIComponent(state)}`;
    await sendB2CMagicLink({ email, redirectUrl });

    res.type('html').send(buildCheckEmailHtml(email));
  } catch (err) {
    next(err);
  }
});

router.get('/b2c/widget/magic-link/callback', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { state, token } = WidgetMagicLinkCallbackSchema.parse(req.query);
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

    const session = await authenticateB2CMagicLink({
      token,
      customerId: payload.customerId,
      sessionDurationMinutes: 60,
    });

    res.type('html').send(buildWidgetGrantHtml({
      title: 'Authorize Tokento Access',
      subtitle: `Grant AI agent access to customer ${payload.customerId} rewards for merchant ${payload.merchantId}.`,
      targetOrigin: payload.origin,
      payload: {
        type: 'tokento_oauth_result',
        state,
        merchantId: payload.merchantId,
        customerId: payload.customerId,
        walletToken: session.sessionJwt,
        fallback: false,
      },
      grantLabel: 'Grant access',
      cancelLabel: 'Cancel',
      showGrantButton: true,
    }));
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

    if (usingPlaceholderB2CConfig()) {
      const devSession = await createDevB2CSessionJwt(payload.customerId);
      walletToken = devSession.sessionJwt;
      fallback = true;
    } else {
      if (!sessionJwt) {
        res.type('html').send(buildWidgetEmailFormHtml({
          state,
          customerId: payload.customerId,
          merchantId: payload.merchantId,
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
