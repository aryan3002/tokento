# ============================================================
# Tokento API
# ============================================================
# Targets a plain Node host (Railway / Render / Fly), NOT Cloudflare Workers.
# The Express + Prisma + ioredis stack cannot run on Workers as-is — app.listen,
# Prisma over raw TCP, ioredis sockets, long-lived SSE and post-response promises
# all require a persistent Node process. Porting to Hono/Drizzle is deliberately
# out of scope; revisit when a customer needs edge latency.

FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.0.0 --activate
WORKDIR /app

# ---- Dependencies ----
FROM base AS deps
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/api/package.json packages/api/
RUN pnpm install --frozen-lockfile

# ---- Build ----
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/shared/node_modules ./packages/shared/node_modules
COPY --from=deps /app/packages/api/node_modules ./packages/api/node_modules
COPY . .
RUN pnpm --filter @tokento/shared build \
 && pnpm --filter @tokento/api db:generate \
 && pnpm --filter @tokento/api build

# ---- Runtime ----
FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/shared ./packages/shared
COPY --from=build /app/packages/api ./packages/api
WORKDIR /app/packages/api

# Run as a non-root user.
RUN addgroup -S tokento && adduser -S tokento -G tokento
USER tokento

EXPOSE 4000

# /health probes Postgres and Redis, so an instance with a dead dependency is
# taken out of rotation rather than silently serving errors.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# migrate deploy applies committed migrations; never db:push, which has no
# migration history and no rollback path.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/index.js"]
