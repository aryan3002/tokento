import { describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import authRoutes from '../src/routes/auth.routes';
import { errorHandler } from '../src/middleware/error.middleware';

describe('widget oauth popup flow', () => {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/auth', authRoutes);
  app.use(errorHandler());

  it('creates signed state then renders grant page with wallet token payload', async () => {
    const stateRes = await request(app)
      .post('/api/v1/auth/b2c/widget/state')
      .send({
        merchantId: 'merchant-demo',
        customerId: 'customer-demo',
        origin: 'http://localhost:8080',
      })
      .expect(200);

    const state = stateRes.body.state as string;
    expect(typeof state).toBe('string');
    expect(state.length).toBeGreaterThan(10);

    const authorizeRes = await request(app)
      .get('/api/v1/auth/b2c/widget/authorize')
      .query({ state })
      .expect(200);

    expect(authorizeRes.headers['content-type']).toContain('text/html');
    expect(authorizeRes.text).toContain('tokento_oauth_result');
    expect(authorizeRes.text).toContain('b2c_dev_session::customer-demo');
    expect(authorizeRes.text).toContain('Grant access');
  });

  it('rejects invalid state', async () => {
    const res = await request(app)
      .get('/api/v1/auth/b2c/widget/authorize')
      .query({ state: 'bad.state' })
      .expect(400);

    expect(res.text).toContain('invalid_state');
  });
});
