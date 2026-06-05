import { describe, expect, it, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import authRoutes from '../src/routes/auth.routes';
import { errorHandler } from '../src/middleware/error.middleware';

const mocks = vi.hoisted(() => ({
  authenticateB2BMagicLink: vi.fn(),
  authenticateB2BSessionJwt: vi.fn(),
  authenticateB2CMagicLink: vi.fn(),
  authenticateB2CSessionJwt: vi.fn(),
  createDevB2BSessionJwt: vi.fn(),
  createDevB2CSessionJwt: vi.fn(),
  resolveDashboardMerchantId: vi.fn(),
  sendB2BMagicLink: vi.fn(),
  sendB2CMagicLink: vi.fn(),
  usingPlaceholderB2BConfig: vi.fn(),
  usingPlaceholderB2CConfig: vi.fn(),
}));

vi.mock('../src/services/stytch.service', () => ({
  authenticateB2BMagicLink: mocks.authenticateB2BMagicLink,
  authenticateB2BSessionJwt: mocks.authenticateB2BSessionJwt,
  authenticateB2CMagicLink: mocks.authenticateB2CMagicLink,
  authenticateB2CSessionJwt: mocks.authenticateB2CSessionJwt,
  createDevB2BSessionJwt: mocks.createDevB2BSessionJwt,
  createDevB2CSessionJwt: mocks.createDevB2CSessionJwt,
  resolveDashboardMerchantId: mocks.resolveDashboardMerchantId,
  sendB2BMagicLink: mocks.sendB2BMagicLink,
  sendB2CMagicLink: mocks.sendB2CMagicLink,
  usingPlaceholderB2BConfig: mocks.usingPlaceholderB2BConfig,
  usingPlaceholderB2CConfig: mocks.usingPlaceholderB2CConfig,
}));

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/auth', authRoutes);
  app.use(errorHandler());
  return app;
}

describe('auth magic-link routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.usingPlaceholderB2BConfig.mockReturnValue(false);
    mocks.usingPlaceholderB2CConfig.mockReturnValue(false);
    mocks.resolveDashboardMerchantId.mockResolvedValue('merchant-1');
    mocks.sendB2BMagicLink.mockResolvedValue({ sent: true, organizationId: 'org-1' });
    mocks.authenticateB2BMagicLink.mockResolvedValue({
      sessionJwt: 'b2b-session-real',
      merchantId: 'merchant-1',
      memberId: 'member-1',
      organizationId: 'org-1',
      fallback: false,
    });
    mocks.authenticateB2CMagicLink.mockResolvedValue({
      sessionJwt: 'b2c-session-real',
      customerId: 'customer-1',
      userId: 'user-1',
      fallback: false,
    });
  });

  it('rejects B2B magic-link start when email is missing', async () => {
    await request(createApp())
      .post('/api/v1/auth/b2b/magic-link/start')
      .send({})
      .expect(400);
  });

  it('starts and completes B2B magic-link login with merchant_id session claim', async () => {
    const startRes = await request(createApp())
      .post('/api/v1/auth/b2b/magic-link/start')
      .send({ email: 'demo@coffeeco.com', merchantId: 'merchant-1' })
      .expect(200);

    expect(startRes.body.sent).toBe(true);
    expect(mocks.sendB2BMagicLink).toHaveBeenCalledTimes(1);
    const redirectUrl = mocks.sendB2BMagicLink.mock.calls[0][0].redirectUrl as string;
    const state = new URL(redirectUrl).searchParams.get('state');
    expect(state).toBeTruthy();

    const callbackRes = await request(createApp())
      .get('/api/v1/auth/b2b/magic-link/callback')
      .query({ state, token: 'stytch-b2b-token' })
      .expect(302);

    expect(mocks.authenticateB2BMagicLink).toHaveBeenCalledWith({
      magicLinksToken: 'stytch-b2b-token',
      merchantId: 'merchant-1',
      sessionDurationMinutes: 60,
    });
    expect(callbackRes.headers.location).toContain('/authenticate#sessionJwt=b2b-session-real');
  });

  it('disables dev B2B sessions when real B2B credentials are configured', async () => {
    const res = await request(createApp())
      .get('/api/v1/auth/b2b/dev-session')
      .expect(403);

    expect(res.body.error.code).toBe('dev_session_disabled');
  });

  it('completes B2C widget callback with customer-bound session', async () => {
    const stateRes = await request(createApp())
      .post('/api/v1/auth/b2c/widget/state')
      .send({
        merchantId: 'merchant-1',
        customerId: 'customer-1',
        origin: 'http://localhost:8080',
      })
      .expect(200);

    const callbackRes = await request(createApp())
      .get('/api/v1/auth/b2c/widget/magic-link/callback')
      .query({ state: stateRes.body.state, token: 'stytch-b2c-token' })
      .expect(200);

    expect(mocks.authenticateB2CMagicLink).toHaveBeenCalledWith({
      token: 'stytch-b2c-token',
      customerId: 'customer-1',
      sessionDurationMinutes: 60,
    });
    expect(callbackRes.text).toContain('b2c-session-real');
    expect(callbackRes.text).toContain('tokento_oauth_result');
  });

  it('rejects tampered B2C widget callback state', async () => {
    const res = await request(createApp())
      .get('/api/v1/auth/b2c/widget/magic-link/callback')
      .query({ state: 'bad.state', token: 'stytch-b2c-token' })
      .expect(400);

    expect(res.text).toContain('invalid_state');
    expect(mocks.authenticateB2CMagicLink).not.toHaveBeenCalled();
  });
});
