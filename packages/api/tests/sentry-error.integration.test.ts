import express from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { errorHandler } from '../src/middleware/error.middleware';

const sentryMocks = vi.hoisted(() => {
  const captureExceptionMock = vi.fn(() => 'evt_test_capture');
  const withScopeMock = vi.fn((callback: (scope: { setTag: (key: string, value: string) => void }) => void) => {
    callback({ setTag: vi.fn() });
  });
  return { captureExceptionMock, withScopeMock };
});

vi.mock('@sentry/node', () => ({
  captureException: sentryMocks.captureExceptionMock,
  withScope: sentryMocks.withScopeMock,
}));

describe('Sentry error capture integration', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    sentryMocks.captureExceptionMock.mockClear();
    sentryMocks.withScopeMock.mockClear();
  });

  it('captures an exception for a thrown route error', async () => {
    const app = express();
    app.get('/boom', () => {
      throw new Error('boom');
    });
    app.use(errorHandler());

    const response = await request(app).get('/boom');

    expect(response.status).toBe(500);
    expect(sentryMocks.withScopeMock).toHaveBeenCalledTimes(1);
    expect(sentryMocks.captureExceptionMock).toHaveBeenCalledTimes(1);
    expect(sentryMocks.captureExceptionMock.mock.calls[0]?.[0]).toBeInstanceOf(Error);
  });
});
