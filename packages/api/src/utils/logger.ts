// ============================================================
// Tokento — Logger (Pino)
// ============================================================
// Structured logging from Day 1 (Revision #10).

import pino from 'pino';

export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport:
    process.env.NODE_ENV === 'development'
      ? {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'SYS:standard',
            ignore: 'pid,hostname',
          },
        }
      : undefined,
  base: {
    service: process.env.OTEL_SERVICE_NAME || 'tokento-api',
    env: process.env.NODE_ENV || 'development',
  },
});

export default logger;
