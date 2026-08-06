# Tokento Public Launch Hardening — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close every finding from the 2026-08-06 audits so the Tokento repo can be made public and a sandbox-only demo can be deployed, without exposing customer data, strategy documents, or an open redemption endpoint.

**Architecture:** Recover the stranded `codex/polish` work into `main` first (fast-forward, no conflicts), then fix authentication and authorization on the money paths, then make money representation correct, then make the repo publishable. The API stays **Express on a Node host** — the Hono/Drizzle edge migration in `Next Steps.md` Step 3 is explicitly **out of scope** and must not be attempted here (it is weeks of rewrite that a public demo does not need).

**Tech Stack:** TypeScript, Express 4, Prisma 6 + Postgres 16, Redis (ioredis), Vitest, Cloudflare Workers (MCP adapter only), Next.js (dashboard), Stytch (auth).

## Global Constraints

- **Node 20+, pnpm 9.** All commands run from `Token/`.
- **Postgres host port is 5434** (not 5433 — collides with a native Homebrew postgresql@17). See `docker-compose.yml:9`.
- **Never weaken an existing passing test to make a new one pass.** If a test must change, say so in the commit body.
- **Every task ends with a green gate:** `pnpm typecheck && pnpm lint && pnpm test`.
- **No secrets in code, ever** — no fallback literals for keys, no `NEXT_PUBLIC_*` credentials.
- **Money is never `Float`** after Task 12. Use `Decimal` at rest and integer-safe arithmetic.
- **The public API contract must not break**: JSON money fields stay JSON numbers, not strings.
- **Do not attempt the Express→Hono or Prisma→Drizzle migration in this plan.**

## Minimum Publishable Set

If time is limited, **Phase 0 + Phase 1 + Phase 4** is the smallest set that makes the *repo* safe to publish (roughly 2 weeks). Phases 2–3 are required only before a **live demo** or a real design partner touches sandbox. Do not publish before Phase 4 Task 19 (history purge) — it is irreversible once the repo is public.

---

## Phase 0 — Recover the stranded work

### Task 1: Fast-forward `main` to `codex/polish`

`main` has 3 commits and zero tests. Six weeks of hardening (Stytch, 18 test files, Sentry, OpenAPI, widget OAuth, webhooks UI, CI) sits on `codex/polish`, which is 59 files / +14,482 lines ahead. `main` is an ancestor of `codex/polish`, so this is a fast-forward with no conflict risk.

**Files:**
- Modify: git refs only. No source changes.

**Interfaces:**
- Produces: a `main` that contains `packages/api/src/services/stytch.service.ts`, `packages/api/tests/*` (18 files), `.github/workflows/*`, `@sentry/node` and `stytch` dependencies. Every later task assumes these exist.

- [ ] **Step 1: Confirm the fast-forward is still clean**

```bash
cd Token
git fetch --all
git status --porcelain          # must be empty
git merge-base --is-ancestor main codex/polish && echo "FF OK" || echo "STOP - not a fast-forward"
```

Expected: `FF OK` and an empty status. If it prints `STOP`, do not continue — report back.

- [ ] **Step 2: Tag the current main as a rollback point**

```bash
git tag pre-polish-merge-2026-08-06
```

- [ ] **Step 3: Fast-forward merge**

```bash
git checkout main
git merge --ff-only codex/polish
```

Expected: `Fast-forward`, ~59 files changed.

- [ ] **Step 4: Install and verify the recovered tree**

```bash
pnpm install
docker compose up -d
pnpm db:generate && pnpm db:push && pnpm db:seed
pnpm typecheck && pnpm lint && pnpm test
```

Expected: all green, and `find packages -name "*.test.ts" -not -path "*/node_modules/*" | wc -l` returns 18, not 0.

- [ ] **Step 5: Fix the two test configs referenced but missing**

`packages/api/package.json` references `vitest.e2e.config.ts` and `vitest.perf.config.ts`, which do not exist. Either create them or remove the scripts. Simplest correct action — remove the dead scripts:

```bash
cd packages/api
# remove the "test:e2e" and "test:perf" entries from package.json scripts
```

Then re-run `pnpm --filter api test` to confirm nothing referenced them.

- [ ] **Step 6: Push and clean up**

```bash
git push origin main
git push origin --delete codex/polish-01 codex/polish-02 codex/polish-03 codex/polish-04 codex/polish-05 2>/dev/null || true
git push origin --delete codex/polish-06 codex/polish-07 codex/polish-08 codex/polish-09 codex/polish-10 2>/dev/null || true
```

Keep `codex/polish` itself until Phase 4 is done, as a second rollback point.

- [ ] **Step 7: Commit the vault correction**

Update `03-Build/Build Status.md` — remove the "documents an unmerged branch" danger banner added on 2026-08-06, since it is now merged. Note the merge date in `03-Build/Next Steps.md`.

---

## Phase 1 — Security criticals (blocks any public deploy)

### Task 2: Kill the dev-session authentication bypass

**This is the single most dangerous line in the codebase and neither audit caught it.** In `stytch.service.ts`, `authenticateB2CSessionJwt()` calls `parseDevB2CToken()` **first**, with no guard on environment or config. Any request with `Authorization: Bearer b2c_dev_session::<any-customer-uuid>` authenticates as that customer — **even in production with real Stytch credentials**. The B2B path has the identical hole (`b2b_dev_session::<merchant-id>`), which means forging merchant-dashboard access too.

**Files:**
- Modify: `packages/api/src/services/stytch.service.ts` (functions `authenticateB2CSessionJwt`, `authenticateB2BSessionJwt`, `parseDevB2CToken`, `parseDevB2BToken`)
- Test: `packages/api/tests/stytch.service.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `authenticateB2CSessionJwt(jwt) => Promise<{customerId, userId, fallback}>` and `authenticateB2BSessionJwt(jwt) => Promise<{merchantId, memberId, organizationId, fallback}>` — unchanged signatures, but dev tokens are now rejected unless **both** `NODE_ENV !== 'production'` **and** placeholder Stytch config is active.

- [ ] **Step 1: Write the failing tests**

Add to `packages/api/tests/stytch.service.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('dev session tokens are refused outside development', () => {
  const OLD_ENV = process.env;

  beforeEach(() => { vi.resetModules(); process.env = { ...OLD_ENV }; });
  afterEach(() => { process.env = OLD_ENV; });

  it('rejects a b2c dev token when NODE_ENV=production', async () => {
    process.env.NODE_ENV = 'production';
    process.env.STYTCH_PROJECT_ID = 'test-project';
    process.env.STYTCH_SECRET = 'test-secret';
    const { authenticateB2CSessionJwt } = await import('../src/services/stytch.service');

    await expect(
      authenticateB2CSessionJwt('b2c_dev_session::11111111-1111-1111-1111-111111111111')
    ).rejects.toThrow(/dev_session_forbidden/);
  });

  it('rejects a b2c dev token when real Stytch credentials are configured', async () => {
    process.env.NODE_ENV = 'development';
    process.env.STYTCH_PROJECT_ID = 'project-live-real';
    process.env.STYTCH_SECRET = 'secret-live-real';
    const { authenticateB2CSessionJwt } = await import('../src/services/stytch.service');

    await expect(
      authenticateB2CSessionJwt('b2c_dev_session::11111111-1111-1111-1111-111111111111')
    ).rejects.toThrow(/dev_session_forbidden/);
  });

  it('rejects a b2b dev token when NODE_ENV=production', async () => {
    process.env.NODE_ENV = 'production';
    process.env.STYTCH_PROJECT_ID = 'test-project';
    process.env.STYTCH_SECRET = 'test-secret';
    const { authenticateB2BSessionJwt } = await import('../src/services/stytch.service');

    await expect(
      authenticateB2BSessionJwt('b2b_dev_session::some-merchant-id')
    ).rejects.toThrow(/dev_session_forbidden/);
  });

  it('still allows a b2c dev token in local development with placeholder config', async () => {
    process.env.NODE_ENV = 'development';
    process.env.STYTCH_PROJECT_ID = 'test-project';
    process.env.STYTCH_SECRET = 'test-secret';
    const { authenticateB2CSessionJwt } = await import('../src/services/stytch.service');

    const result = await authenticateB2CSessionJwt('b2c_dev_session::cust-123');
    expect(result.customerId).toBe('cust-123');
    expect(result.fallback).toBe(true);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter api test -- stytch.service`
Expected: the three rejection tests FAIL (dev tokens are currently accepted everywhere); the fourth passes.

- [ ] **Step 3: Implement the guard**

In `packages/api/src/services/stytch.service.ts`, add a single gate and call it from both authenticate functions **before** the dev-token parse:

```typescript
function devSessionsAllowed(): boolean {
  return process.env.NODE_ENV !== 'production' && usingPlaceholderStytchConfig();
}

function assertDevSessionAllowed(kind: 'b2c' | 'b2b'): void {
  if (!devSessionsAllowed()) {
    throw new Error(`dev_session_forbidden:${kind}`);
  }
}
```

Then in `authenticateB2CSessionJwt`:

```typescript
const devSession = parseDevB2CToken(sessionJwt);
if (devSession) {
  assertDevSessionAllowed('b2c');
  return { ...devSession, fallback: true };
}
```

And the mirror change in `authenticateB2BSessionJwt` with `assertDevSessionAllowed('b2b')`.

Note: `usingPlaceholderStytchConfig()` currently ANDs the B2C and B2B checks. Change the two call sites to use the specific `usingPlaceholderB2CConfig()` / `usingPlaceholderB2BConfig()` so configuring one real client does not leave the other bypassable.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter api test -- stytch.service`
Expected: PASS (all four).

- [ ] **Step 5: Add a boot-time warning**

In `packages/api/src/index.ts`, immediately after `Sentry.init`, refuse to start in production with placeholder auth:

```typescript
if (process.env.NODE_ENV === 'production' && usingPlaceholderStytchConfig()) {
  throw new Error('Refusing to start: placeholder Stytch config in production.');
}
```

- [ ] **Step 6: Commit**

```bash
git add packages/api/src/services/stytch.service.ts packages/api/src/index.ts packages/api/tests/stytch.service.test.ts
git commit -m "fix(auth): refuse dev session tokens outside local development

Dev tokens (b2c_dev_session::<id>) authenticated as any customer even in
production with real Stytch credentials. Now gated on NODE_ENV and
placeholder config, and the API refuses to boot in prod with placeholders."
```

---

### Task 3: Enforce redemption ownership and return 409 on double-redeem

`redemptionService.redeem()` never compares the token's owner to the authenticated caller, so any authenticated customer can redeem **any** token by ID. Separately, the concurrency loser currently gets an HTTP 500 (`P2025` escapes as `internal_error`), which an agent cannot distinguish from an outage — so it will retry a settled financial operation.

**Files:**
- Modify: `packages/api/src/services/redemption.service.ts`
- Modify: `packages/api/src/routes/redemption.routes.ts:22`
- Test: `packages/api/tests/redemption.service.test.ts`

**Interfaces:**
- Consumes: `req.customerId` set by `authenticateBearerToken()` (trustworthy only after Task 2).
- Produces: `redemptionService.redeem(tokenId: string, data: RedeemTokenRequest, opts: { isSandbox?: boolean; authenticatedCustomerId: string }) => Promise<RedeemTokenResponse>`. **This signature change is consumed by Task 4.** Throws `AppError(403,'forbidden')` on owner mismatch and `AppError(409,'already_redeemed')` on a lost concurrency race.

- [ ] **Step 1: Write the failing tests**

Add to `packages/api/tests/redemption.service.test.ts`:

```typescript
it('refuses to redeem a token belonging to another customer', async () => {
  // token seeded with customerId 'owner-1'
  await expect(
    redemptionService.redeem(tokenId, { merchantId, transactionAmount: 20 }, {
      authenticatedCustomerId: 'attacker-2',
    })
  ).rejects.toMatchObject({ statusCode: 403, code: 'forbidden' });
});

it('does not leak another customer token via the already-redeemed path', async () => {
  // token already redeemed, owned by 'owner-1'
  await expect(
    redemptionService.redeem(redeemedTokenId, { merchantId, transactionAmount: 20 }, {
      authenticatedCustomerId: 'attacker-2',
    })
  ).rejects.toMatchObject({ statusCode: 403 });
});

it('returns 409 (not 500) when the same token is redeemed concurrently', async () => {
  const call = () => redemptionService.redeem(tokenId, { merchantId, transactionAmount: 20 }, {
    authenticatedCustomerId: 'owner-1',
  });
  const results = await Promise.allSettled([call(), call()]);
  const rejected = results.filter(r => r.status === 'rejected');
  expect(rejected).toHaveLength(1);
  expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({ statusCode: 409 });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter api test -- redemption.service`
Expected: FAIL — ownership tests fail (no check exists), concurrency test fails with 500 not 409.

- [ ] **Step 3: Implement ownership + interactive transaction**

Change the signature and add the ownership check **before** the duplicate-check early return (otherwise the early return leaks another customer's redemption):

```typescript
async redeem(
  tokenId: string,
  data: RedeemTokenRequest,
  opts: { isSandbox?: boolean; authenticatedCustomerId: string },
): Promise<RedeemTokenResponse> {
  const token = await prisma.token.findUnique({ where: { id: tokenId } });
  if (!token) throw new AppError(404, 'token_not_found', 'Token not found.');

  if (token.customerId !== opts.authenticatedCustomerId) {
    throw new AppError(403, 'forbidden', 'Token does not belong to the authenticated customer.');
  }

  const existing = await prisma.redemption.findUnique({ where: { tokenId } });
  if (existing) { /* unchanged alreadyRedeemed response */ }
  // ... re-validation unchanged, now passing opts.isSandbox
```

Replace the batch `$transaction([...])` with an interactive transaction so the conditional update and the redemption insert share one scope, and map the miss to 409:

```typescript
const redemption = await prisma.$transaction(async (tx) => {
  const updated = await tx.token.updateMany({
    where: { id: tokenId, status: TokenStatus.ACTIVE },
    data: { status: TokenStatus.REDEEMED, redeemedAt: new Date() },
  });
  if (updated.count === 0) {
    throw new AppError(409, 'already_redeemed', 'Token is no longer active.');
  }
  return tx.redemption.create({ data: { /* unchanged */ } });
});
```

`updateMany` returns a count instead of throwing `P2025`, which removes the 500 entirely.

- [ ] **Step 4: Update the route to pass the authenticated identity**

`packages/api/src/routes/redemption.routes.ts`:

```typescript
const result = await redemptionService.redeem(tokenId, data, {
  isSandbox: req.isSandbox,
  authenticatedCustomerId: req.customerId!,
});
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter api test -- redemption.service`
Expected: PASS. Then `pnpm --filter api test` to confirm no regression.

- [ ] **Step 6: Commit**

```bash
git add packages/api/src/services/redemption.service.ts packages/api/src/routes/redemption.routes.ts packages/api/tests/redemption.service.test.ts
git commit -m "fix(redeem): enforce token ownership and return 409 on lost race"
```

---

### Task 4: Make sandbox isolation actually work

`sandboxIsolation()` is registered globally at `index.ts` **before** any auth runs, so `req.isSandbox` is always `undefined` at that point and the middleware unconditionally overwrites it from `SANDBOX_MODE`. It is a no-op. Validate and redeem then pass `undefined` to services that treat `undefined` as "skip the check", so sandbox and production tokens mix on the money paths.

**Files:**
- Modify: `packages/api/src/index.ts:35` (remove the global registration)
- Modify: `packages/api/src/middleware/sandbox.middleware.ts`
- Modify: `packages/api/src/routes/validation.routes.ts`, `packages/api/src/routes/wallet.routes.ts`
- Test: `packages/api/tests/sandbox.middleware.test.ts`

**Interfaces:**
- Consumes: `redemptionService.redeem(..., { isSandbox, authenticatedCustomerId })` from Task 3.
- Produces: `req.isSandbox` is always a boolean by the time any route handler runs, derived from the authenticated principal (API key's `isSandbox`, or the customer's merchant context), never from a global env default.

- [ ] **Step 1: Write the failing test**

```typescript
it('rejects a sandbox token on a production-authenticated redeem', async () => {
  const res = await request(app)
    .post(`/api/v1/tokens/${sandboxTokenId}/redeem`)
    .set('Authorization', `Bearer ${productionCustomerSession}`)
    .send({ merchantId, transactionAmount: 20, idempotencyKey: 'k1' });
  expect(res.status).toBe(400);
  expect(res.body.error.code).toMatch(/sandbox/);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter api test -- sandbox`
Expected: FAIL — currently returns 200, sandbox and production mix.

- [ ] **Step 3: Move isolation into the authenticated path**

Delete `app.use(sandboxIsolation())` from `index.ts`. Set `req.isSandbox` inside `authenticateApiKey()` (from the key record, which already has `isSandbox`) and inside `authenticateBearerToken()` (resolve from the customer's wallet/merchant record). Change `sandboxIsolation()` into a route-level assertion used after auth:

```typescript
export function requireSandboxMatch() {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (typeof req.isSandbox !== 'boolean') {
      res.status(500).json({ error: { code: 'sandbox_unresolved',
        message: 'Sandbox context was not established during authentication.' },
        requestId: req.requestId });
      return;
    }
    next();
  };
}
```

- [ ] **Step 4: Pass `isSandbox` into every service call**

`wallet.routes.ts` → `walletService.queryTokens(customerId, params, req.isSandbox)`; `validation.routes.ts` → `validationService.validate(tokenId, data, req.isSandbox)`; redeem already threads it via Task 3. Then remove the `undefined` escape hatch in `validation.service.ts:47-58` and `wallet.service.ts:46` so a missing value is a hard error rather than a skipped check.

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter api test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git commit -am "fix(sandbox): resolve isSandbox during auth and enforce on all money paths"
```

---

### Task 5: Tenant-scope idempotency and stop caching failures

The cache key is `method:path:key`, and for mint the path is the constant `/mint` for every merchant — so a colliding or guessed `Idempotency-Key` returns **another merchant's** full mint response including token ID, customer ID, and signature. The middleware also caches 4xx/5xx responses for 24h, pinning transient errors. And the MCP adapter sends `idempotencyKey` only in the request **body**, which the middleware never reads — so MCP redemptions have no idempotency at all.

**Files:**
- Modify: `packages/api/src/middleware/idempotency.middleware.ts`
- Modify: `packages/api/src/routes/redemption.routes.ts` (accept body key)
- Test: `packages/api/tests/idempotency.middleware.test.ts`

**Interfaces:**
- Produces: cache key format `` `${tenant}:${method}:${path}:${idempotencyKey}` `` where `tenant` is `req.merchantId ?? req.customerId ?? 'anon'`. Only 2xx responses are cached.

- [ ] **Step 1: Write the failing tests**

```typescript
it('does not return merchant A cached response to merchant B', async () => {
  await mintAs(merchantA, { idempotencyKey: 'shared-key' });
  const res = await mintAs(merchantB, { idempotencyKey: 'shared-key' });
  expect(res.body.merchantId).toBe(merchantB.id);
});

it('does not cache a 4xx response', async () => {
  await request(app).post('/api/v1/tokens/mint').set('Idempotency-Key', 'k9')
    .set('X-API-Key', key).send({ /* invalid body */ }).expect(400);
  const ok = await request(app).post('/api/v1/tokens/mint').set('Idempotency-Key', 'k9')
    .set('X-API-Key', key).send(validMintBody);
  expect(ok.status).toBe(200);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter api test -- idempotency`
Expected: FAIL — cross-tenant test returns merchant A's payload; second test returns the cached 400.

- [ ] **Step 3: Implement scoping and success-only caching**

```typescript
const tenant = req.merchantId ?? req.customerId ?? 'anon';
const key = `${tenant}:${req.method}:${req.path}:${idempotencyKey}`;
```

and inside the `res.json` override, only persist when `res.statusCode >= 200 && res.statusCode < 300`.

- [ ] **Step 4: Honor the body-supplied key on redeem**

In `redemption.routes.ts`, before the `idempotency()` middleware runs, promote a body key into the header so one code path handles both:

```typescript
router.post('/:id/redeem',
  authenticateBearerToken(),
  (req, _res, next) => {
    if (!req.headers['idempotency-key'] && typeof req.body?.idempotencyKey === 'string') {
      req.headers['idempotency-key'] = req.body.idempotencyKey;
    }
    next();
  },
  rateLimit('REDEEM'),
  idempotency(),
  /* handler */
);
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter api test -- idempotency`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git commit -am "fix(idempotency): scope keys per tenant, cache only 2xx, honor body key on redeem"
```

---

### Task 6: Fail fast on missing HMAC master key

`utils/crypto.ts:9` falls back to the literal `'dev-hmac-master-key-change-me'`, so a missing env var in production silently yields publicly-known signing keys.

**Files:**
- Modify: `packages/api/src/utils/crypto.ts`
- Test: `packages/api/tests/crypto.test.ts` (create)

- [ ] **Step 1: Write the failing test**

```typescript
it('refuses to load with a missing HMAC master key in production', async () => {
  vi.resetModules();
  process.env.NODE_ENV = 'production';
  delete process.env.HMAC_MASTER_KEY;
  await expect(import('../src/utils/crypto')).rejects.toThrow(/HMAC_MASTER_KEY/);
});
```

- [ ] **Step 2: Run to verify it fails** — `pnpm --filter api test -- crypto`. Expected: FAIL (module loads happily).

- [ ] **Step 3: Implement**

```typescript
const MASTER_KEY = (() => {
  const key = process.env.HMAC_MASTER_KEY;
  if (key) return key;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('HMAC_MASTER_KEY is required in production.');
  }
  return 'dev-hmac-master-key-change-me';
})();
```

- [ ] **Step 4: Run to verify it passes.**

- [ ] **Step 5: Widen the signed payload**

`buildTokenSignaturePayload` covers only 6 fields. Add `minimumTransactionFloor` and `agentPresentableFlag` so a DB-write attacker cannot lower the floor or flip presentability without breaking the MAC. **This invalidates existing signatures** — acceptable now because all data is sandbox seed data. Re-run `pnpm db:seed` after.

- [ ] **Step 6: Commit** — `git commit -am "fix(crypto): require HMAC_MASTER_KEY in production, widen signed payload"`

---

### Task 7: Stop the MCP adapter forging customer identity

The Worker builds `Authorization: Bearer b2c_dev_session::${customer_id}` from an untrusted tool argument for wallet reads, and sends a constant `b2c_dev_session::mcp-agent` for validate and redeem. The API's ownership check then compares the path parameter against that same attacker-supplied value — a tautology. The Worker is also unauthenticated with CORS `*`, so deployed publicly it is an open redemption endpoint.

**Files:**
- Modify: `packages/mcp-adapter/src/index.ts` (tool schemas, all three fetch calls, CORS)
- Modify: `packages/mcp-adapter/wrangler.toml`
- Modify: `packages/checkout-widget/src/widget.ts` (hand the session token to the agent)
- Test: `packages/mcp-adapter/test/*.test.ts`

**Interfaces:**
- Consumes: the B2C session JWT minted by the checkout widget's OAuth handoff.
- Produces: all three MCP tools take a required `wallet_token: string` argument instead of deriving identity from `customer_id`. `query_loyalty_tokens` keeps `customer_id` only as a path parameter, and the API rejects any mismatch with the token's claim.

- [ ] **Step 1: Write the failing test**

```typescript
it('refuses a tool call with no wallet_token', async () => {
  const res = await worker.fetch(mcpCall('redeem_token', { token_id: 't1' }));
  expect(res.status).toBe(401);
});

it('never synthesizes a bearer token from a tool argument', async () => {
  const spy = vi.spyOn(globalThis, 'fetch');
  await worker.fetch(mcpCall('query_loyalty_tokens', {
    customer_id: 'victim', wallet_token: 'session-abc',
  }));
  const sent = spy.mock.calls[0][1].headers['Authorization'];
  expect(sent).toBe('Bearer session-abc');
  expect(sent).not.toContain('dev_session');
});
```

- [ ] **Step 2: Run to verify it fails** — `pnpm --filter mcp-adapter test`. Expected: FAIL.

- [ ] **Step 3: Implement token pass-through**

Add `wallet_token` as a required property on all three tool input schemas, then replace every hardcoded header:

```typescript
// was: 'Authorization': `Bearer b2c_dev_session::${customerId}`
headers: { 'Authorization': `Bearer ${args.wallet_token}` }
```

Return a 401 MCP error when `wallet_token` is absent. Delete the unused `MCP_AUTH_TOKEN` declaration or wire it as a Worker-level shared secret — do not leave it dangling.

- [ ] **Step 4: Lock the Worker's CORS**

Replace `Access-Control-Allow-Origin: *` with an allowlist read from an env var (`ALLOWED_ORIGINS`), defaulting to empty in production.

- [ ] **Step 5: Fix the wrangler production config**

`wrangler.toml:6` ships `API_BASE_URL = "http://localhost:4000"` as the **default** var, so deploying as-is points production at localhost. Move localhost into a `[env.dev]` block, make the top-level default the production URL, and add `compatibility_flags = ["nodejs_compat"]`.

- [ ] **Step 6: Run tests to verify they pass** — `pnpm --filter mcp-adapter test`. Expected: PASS.

- [ ] **Step 7: Re-verify the end-to-end demo still works**

```bash
pnpm dev
# then run the wallet → validate → redeem loop from the demo script
```

The demo must still work; if the widget does not yet hand a real session token to Claude Desktop, use a locally-minted dev session (which Task 2 still permits in development).

- [ ] **Step 8: Commit** — `git commit -am "fix(mcp): pass through real wallet session tokens, lock CORS, fix wrangler prod config"`

---

### Task 8: Remove the merchant API key from the browser bundle

`dashboard/src/app/page.tsx:4-7` reads `NEXT_PUBLIC_TOKENTO_API_KEY` with a hardcoded fallback, ships an ALL_SCOPES key into the client bundle, and renders it with a copy button.

**Files:**
- Create: `packages/dashboard/src/app/api/proxy/[...path]/route.ts`
- Modify: `packages/dashboard/src/app/page.tsx`

- [ ] **Step 1: Create a server-side proxy route** that holds `TOKENTO_API_KEY` (no `NEXT_PUBLIC_` prefix) server-side and forwards to the API, so the key never reaches the browser.

- [ ] **Step 2: Point every client fetch at `/api/proxy/...`** and delete the hardcoded fallback constant and the key-display UI.

- [ ] **Step 3: Verify the key is gone from the bundle**

```bash
pnpm --filter dashboard build
grep -r "tk_dev_local_sandbox" packages/dashboard/.next/ && echo "FAIL - key in bundle" || echo "OK - key absent"
```

Expected: `OK - key absent`.

- [ ] **Step 4: Commit** — `git commit -am "fix(dashboard): proxy API calls server-side, remove key from client bundle"`

---

### Task 9: Stop the SSE stream broadcasting customer data to every merchant

`routes/events.routes.ts:66-72` deliberately broadcasts any event lacking a `merchantId` to **every** connected merchant, and `wallet.created` carries a raw `customerId`. Combined with Tasks 2–3 this was a full wallet-harvesting chain. The stream also authenticates via a full-scope API key in the **query string**, which lands in proxy and CDN logs.

**Files:**
- Modify: `packages/api/src/routes/events.routes.ts`
- Modify: `packages/api/src/services/token.service.ts:80` (add `merchantId` to the `wallet.created` payload)
- Modify: `packages/dashboard/src/app/page.tsx:141`

- [ ] **Step 1: Write a failing test** asserting a merchant connected to the stream never receives an event whose `merchantId` differs from its own, including unscoped event types.

- [ ] **Step 2: Invert the filter** — default to **drop** rather than broadcast. An event with no `merchantId` is a bug; log it and skip it.

- [ ] **Step 3: Add `merchantId` to the `wallet.created` emit** in `token.service.ts` so it routes correctly instead of being dropped.

- [ ] **Step 4: Move SSE auth out of the query string.** Use the proxy route from Task 8 to attach the key as a header server-side. Apply the same scope and `expiresAt` checks the shared middleware performs — the SSE route currently re-implements key auth and skips both.

- [ ] **Step 5: Run tests, verify the dashboard still updates live**, then commit.

---

### Task 10: Fix rate limiting so it cannot be trivially bypassed

All customer-facing routes key on `req.ip`, and the app never sets `trust proxy`, so behind any load balancer every caller shares one global bucket — both bypassable by rotating IPs and weaponizable as a DoS against all customers. The limiter also fails **open** on any Redis error.

**Files:**
- Modify: `packages/api/src/index.ts` (add `app.set('trust proxy', 1)`)
- Modify: `packages/api/src/middleware/rate-limit.middleware.ts`

- [ ] **Step 1: Write failing tests** for: (a) two customers do not share a bucket; (b) redeem fails **closed** when Redis is unavailable.

- [ ] **Step 2: Set `app.set('trust proxy', 1)`** so `req.ip` reflects `X-Forwarded-For` behind a proxy.

- [ ] **Step 3: Key by principal, not IP** — `req.merchantId ?? req.customerId ?? req.ip`, and register `rateLimit()` **after** the auth middleware on every route so the principal exists.

- [ ] **Step 4: Fail closed on the money paths.** For `REDEEM` and `MINT`, a Redis error must return 503, not silently allow. Query and validate may keep failing open.

- [ ] **Step 5: Fix the off-by-one** — `count > limit` permits `limit + 1` requests per window; use `>=`.

- [ ] **Step 6: Add limits to the currently unlimited routes** — `POST /v1/merchants` (unauthenticated!), `/v1/merchants/me/*`, `GET /v1/tokens/:id`, `GET /v1/redemptions`, `GET /v1/events/stream`.

- [ ] **Step 7: Run tests, commit.**

---

### Task 11: Close the remaining deploy-time security gaps

**Files:** `packages/api/src/index.ts`, `packages/api/src/services/merchant.service.ts`

- [ ] **Step 1: Replace `app.use(cors())`** (which sends `Access-Control-Allow-Origin: *` on a payments-adjacent API) with an allowlist from `ALLOWED_ORIGINS`.

- [ ] **Step 2: Make `/health` real** — it currently returns `{status:"ok"}` unconditionally and never checks Postgres or Redis, so a load balancer keeps routing to a broken instance. Add a `SELECT 1` and a Redis `PING`, returning 503 on failure. Keep it unauthenticated but do not leak version or connection strings.

- [ ] **Step 3: Add a SIGTERM handler** with `server.close()` and a drain timeout, so deploys stop dropping in-flight audit, idempotency, and webhook work.

- [ ] **Step 4: Fix scope escalation** — `merchant.service.ts:113-118` lets a key holding only `merchants:write` mint a new key with **arbitrary** scopes. Intersect requested scopes with the caller's.

- [ ] **Step 5: Gate merchant self-registration.** `POST /v1/merchants` is unauthenticated and auto-issues an ALL_SCOPES key. For a public demo, put it behind an invite code (`SIGNUP_INVITE_CODE`) or disable it in production entirely.

- [ ] **Step 6: Run the full gate and commit.**

---

## Phase 2 — Money correctness

### Task 12: Migrate money columns from `Float` to `Decimal`

8 columns store money as IEEE-754 doubles: `EarnRule.spendThreshold`, `EarnRule.tokenDenomination`, `EarnRule.minimumTransactionFloor`, `Token.denomination`, `Token.minimumTransactionFloor`, `Redemption.transactionAmount`, `Redemption.tokenDenomination`, `Redemption.netValue`. `netValue = Math.max(0, amount - denomination)` inherits binary rounding error on every cent.

**Files:**
- Modify: `packages/api/prisma/schema.prisma`
- Create: `packages/api/src/utils/money.ts`
- Modify: every service that reads or writes those fields
- Test: `packages/api/tests/money.test.ts`

**Interfaces:**
- Produces: `toMoneyNumber(d: Prisma.Decimal): number` and `subtractMoney(a, b): Prisma.Decimal`. **The public JSON contract stays numbers** — convert at the service boundary with `toMoneyNumber` so OpenAPI, the dashboard, the widget, and the MCP adapter are unaffected.

- [ ] **Step 1: Write the failing test**

```typescript
it('computes net value without floating point drift', async () => {
  const res = await redeem({ transactionAmount: 20.10, denomination: 5.05 });
  expect(res.netTransactionValue).toBe(15.05);   // 15.049999999999999 with Float
});
```

- [ ] **Step 2: Run to verify it fails.**

- [ ] **Step 3: Change the schema** — all 8 columns to `Decimal @db.Decimal(12, 2)`.

- [ ] **Step 4: Add the money helper** and use `Prisma.Decimal` arithmetic in `redemption.service.ts` and `token.service.ts` instead of `Math.max`/`-`.

- [ ] **Step 5: Convert at the boundary only** — every API response maps Decimal → number via `toMoneyNumber`, so no response body changes shape.

- [ ] **Step 6: Regenerate, push, reseed, run the full suite.**

```bash
pnpm db:generate && pnpm db:push && pnpm db:seed && pnpm test
```

- [ ] **Step 7: Commit** — `git commit -am "fix(money): store monetary values as Decimal(12,2)"`

---

### Task 13: Make the settlement stub honest and non-leaking

`settlementReference` is a random hex string with no counterparty, amount, or state — written once, echoed back, never read again. There is no ledger, no double-entry, no payout table, no reconciliation. `settlementType` and `settlementTiming` are written at signup and never read by any code path. The "fraud check stub" documented in `Build Status.md` **does not exist in code at all**.

**Do not build a double-entry ledger in this plan.** It is not needed until real money moves, and building it now is weeks of work that a public demo does not justify. Instead, make the stub explicit so it cannot be mistaken for working settlement — your `CLAUDE.md` requires exactly this ("don't introduce a stub without auditing that it isn't leaking into business logic").

**Files:**
- Modify: `packages/api/src/services/redemption.service.ts`
- Modify: `packages/api/src/utils/ids.ts:44-46`
- Modify: `README.md`, `packages/api/openapi.yaml`

- [ ] **Step 1: Rename the field to tell the truth** — `settlementReference` → keep the wire name for contract stability, but document it in OpenAPI as *"An opaque correlation ID. Settlement is not implemented; no funds move."*

- [ ] **Step 2: Add an explicit capability flag** — `SETTLEMENT_ENABLED=false` in `.env.example`, and have the redeem response include `"settlementStatus": "not_implemented"` so no integrator can mistake a redemption for a payout.

- [ ] **Step 3: Delete or implement the dead config** — `settlementType` / `settlementTiming` either branch behavior or come out of the schema. Prefer removing them until Phase 2 of the product.

- [ ] **Step 4: Remove the false fraud-stub claim** from `Build Status.md`, or add a genuine minimal velocity check (redemptions per customer per hour) backed by a test. Pick one; do not leave the doc claiming something that does not exist.

- [ ] **Step 5: Commit.**

---

### Task 14: Emit `token.expired` and add an expiry sweeper

`EventType.TOKEN_EXPIRED` is defined, subscribed by the webhook service and the SSE stream, and advertised in the dashboard — but **nothing anywhere emits it**. Expiry is enforced only by a query-time filter, so a token nobody validates stays `ACTIVE` in the database forever past `expiryAt`, and merchant liability reports over-report live tokens.

**Files:**
- Create: `packages/api/src/jobs/expiry-sweeper.ts`
- Modify: `packages/api/src/index.ts`
- Test: `packages/api/tests/expiry-sweeper.test.ts`

- [ ] **Step 1: Write the failing test** — seed a token with `expiryAt` in the past, run the sweeper, assert status becomes `EXPIRED` and a `token.expired` event fires exactly once.

- [ ] **Step 2: Run to verify it fails.**

- [ ] **Step 3: Implement the sweeper** — batch `updateMany` where `status = ACTIVE AND expiryAt < now()`, then emit one event per affected token. Run it on an interval (default 60s, `EXPIRY_SWEEP_INTERVAL_MS`), guarded so only one instance sweeps (a Redis `SET NX` lock with a short TTL).

- [ ] **Step 4: Fix the liability query** — `merchant.service.ts:95-101` filters on `status` alone; add the `expiryAt` guard so reports are correct even between sweeps.

- [ ] **Step 5: Run tests, commit.**

---

### Task 15: Make webhook delivery durable

`nextRetryAt` is written and indexed but **nothing reads it** — no cron, no worker, no queue. `attempts` is hardcoded to `1`, so `MAX_RETRIES: 5` and the backoff array are dead config and a failed delivery is never re-sent. Worse, the `WebhookDelivery` row is created *inside* the event listener, **after** the emit — so a crash between the redeem commit and the listener loses the event permanently, with no record a webhook was owed.

**Files:**
- Modify: `packages/api/prisma/schema.prisma` (add an outbox table)
- Modify: `packages/api/src/services/redemption.service.ts`, `token.service.ts`
- Create: `packages/api/src/jobs/webhook-worker.ts`
- Test: `packages/api/tests/webhook-worker.test.ts`

- [ ] **Step 1: Write the failing tests** — (a) a delivery that fails once is retried with backoff and eventually succeeds; (b) an event written inside the redeem transaction survives a simulated crash before dispatch.

- [ ] **Step 2: Add a transactional outbox.** Write an `OutboxEvent` row **inside** the same `$transaction` as the redemption (Task 3 made it interactive, so this is now possible). The emitter becomes a fast path; the outbox is the durable path.

- [ ] **Step 3: Implement the retry worker** — poll `WebhookDelivery` where `status = 'failed' AND nextRetryAt <= now() AND attempts < MAX_RETRIES`, dispatch, increment `attempts`, and compute the next backoff from the existing array. Same single-instance lock as Task 14.

- [ ] **Step 4: Run tests, commit.**

---

## Phase 3 — Deployability

### Task 16: Introduce real Prisma migrations

There is **no `prisma/migrations/` directory and `.gitignore:22` explicitly excludes it.** Only `db:push` is wired. There is no migration history, no reviewable schema diff, and no rollback path. This must be fixed before any merchant data exists.

- [ ] **Step 1: Remove `packages/api/prisma/migrations/` from `.gitignore`.**

- [ ] **Step 2: Baseline the current schema**

```bash
cd packages/api
pnpm prisma migrate dev --name baseline_v1
```

- [ ] **Step 3: Verify the migration reproduces a clean database**

```bash
docker compose down -v && docker compose up -d
pnpm --filter api prisma migrate deploy && pnpm db:seed && pnpm test
```

Expected: green from an empty volume.

- [ ] **Step 4: Change CI and docs** to use `migrate deploy`, and reserve `db:push` for local experimentation only.

- [ ] **Step 5: Commit the migrations directory.**

---

### Task 17: Deploy the API as a Node service (not Workers)

The locked target in `Decision Log` is Cloudflare Workers, but the Express API **cannot run there as-is**: `app.listen`, Prisma over raw TCP, `ioredis` raw sockets, CJS `require` in `token.service.ts:88`, `"module": "commonjs"`, long-lived SSE with `setInterval`, and post-response promises needing `ctx.waitUntil`. That is the Hono/Drizzle rewrite — **explicitly out of scope**.

**Recommendation:** deploy the API to a Node host (Railway, Render, or Fly), Postgres to Neon, Redis to Upstash, dashboard to Vercel, and keep **only** the MCP adapter on Workers where it already runs correctly. Revisit the edge migration when there is a paying customer who needs it.

- [ ] **Step 1: Add a `Dockerfile`** for `packages/api` (multi-stage, `node:20-alpine`, `prisma generate` at build, `migrate deploy` at start).

- [ ] **Step 2: Replace `redis.keys(pattern)`** in `token.service.ts:164` and `redemption.service.ts:60` — it is an O(N) blocking keyspace scan on the hot mint and redeem paths, unsafe on shared or clustered Redis. Track wallet cache keys in a per-customer Redis Set and delete by members.

- [ ] **Step 3: Move every secret to the host's secret store.** `HMAC_MASTER_KEY`, `STYTCH_*`, `DATABASE_URL`, `SENTRY_DSN`. Nothing in `.env` in production.

- [ ] **Step 4: Deploy to staging and run the full demo loop against it.**

- [ ] **Step 5: Fix the three-way port disagreement** — compose publishes 5434, `.env.example` says 5432, the dashboard UI says 5433. Make all three 5434.

- [ ] **Step 6: Commit.**

---

## Phase 4 — Public repo readiness

### Task 18: ⚠️ The repo is ALREADY PUBLIC — this is incident response, not prevention

**Verified 2026-08-06:** `github.com/aryan3002/tokento` is `"visibility": "PUBLIC"`, last pushed 2026-06-05. `TOKENTO.pdf` and `Tokento_Strategic_Specification_v2.docx` are live on `origin/main` **right now**, and all 10 `codex/polish*` branches are also public.

Assume both documents have been indexed by GitHub search, code-search tools, and any scraper that crawls new public repos. Treat the strategic specification as **already disclosed**.

**Good news, verified:** no real `.env` was ever committed (only `.env.example`), and a history scan for live Stytch/Sentry/Stripe credential patterns found nothing. The only committed key is the clearly-labelled sandbox seed key. **No credential rotation appears necessary** — confirm with the gitleaks scan in Task 20 before concluding that.

- [ ] **Step 1: Decide visibility now, before anything else**

Two defensible options — pick deliberately:

- **(a) Flip to private immediately**, complete Phases 1–4, then re-publish deliberately. Stops further spread of the strategy docs. Recommended if the strategy documents matter.
- **(b) Stay public**, purge the documents (Task 19), and accept that the already-disclosed copies are out. Reasonable if the strategy content is not truly sensitive — the market has moved past it anyway (see `Market Reality Check - 2026-08-06`).

```bash
gh repo edit aryan3002/tokento --visibility private   # option (a)
```

- [ ] **Step 2: If staying public, understand the security exposure is live.** Every Phase 1 finding is currently readable by anyone: the dev-session auth bypass, the missing redeem ownership check, the MCP identity forgery. Nothing is deployed, so there is no live system to attack — **but do not deploy anything until Phase 1 is complete.** A public repo plus a deployed demo with these holes is an open redemption endpoint with a published map.

- [ ] **Step 3: Read the exposed documents and decide what actually matters.** If they name PayPal contacts, equity discussions, or merchant targets, that is the real damage — not the architecture. Architecture being public is fine and arguably good.

---

### Task 19: Purge strategy documents from git history

`TOKENTO.pdf` and `Tokento_Strategic_Specification_v2.docx` are **tracked in the repo**. Publishing as-is would expose the full strategic specification, revenue model, and PayPal channel discussion. Deleting them in a new commit is **not sufficient** — they remain in history.

- [ ] **Step 1: Back up the repository**

```bash
cd .. && cp -R Token Token-backup-$(date +%Y%m%d) && cd Token
```

- [ ] **Step 2: Confirm exactly what is tracked**

```bash
git log --all --name-only --pretty=format: | sort -u | grep -iE "\.pdf|\.docx"
```

- [ ] **Step 3: Purge from all history** with `git filter-repo` (preferred over `filter-branch`):

```bash
brew install git-filter-repo
git filter-repo --invert-paths --path TOKENTO.pdf --path Tokento_Strategic_Specification_v2.docx --force
```

- [ ] **Step 4: Add them to `.gitignore`** so they cannot be re-added, and keep the local copies (they are referenced by the vault).

- [ ] **Step 5: Verify they are gone**

```bash
git log --all --name-only --pretty=format: | grep -ciE "TOKENTO\.pdf|Specification_v2" 
```

Expected: `0`.

- [ ] **Step 6: Force-push the rewritten history**

```bash
git push origin --force --all && git push origin --force --tags
```

Note: this rewrites history, so the `pre-polish-merge` tag and `codex/polish` refs change hashes. That is expected and fine.

- [ ] **Step 7: Purge GitHub's own caches.** Force-pushing does **not** remove blobs from GitHub — old commits stay reachable via their SHA and through forks and the API indefinitely. After force-pushing, open a GitHub support request to garbage-collect the repository, or (simpler and more reliable) **delete the repository and re-create it** from the cleaned local history. Deleting and re-creating is the only way to be certain, and costs you the stars/forks you do not yet have.

- [ ] **Step 8: Delete the 10 public `codex/polish*` branches from the remote** — they are currently public and contain the same documents plus the unhardened code.

```bash
for b in polish polish-01 polish-02 polish-03 polish-04 polish-05 polish-06 polish-07 polish-08 polish-09; do
  git push origin --delete "codex/$b" 2>/dev/null || true
done
```

Do this **after** Task 1's fast-forward merge has landed on `main`, so nothing is lost.

---

### Task 20: Scan for secrets and rotate anything exposed

- [ ] **Step 1: Scan the full history**

```bash
brew install gitleaks
gitleaks detect --source . --log-opts="--all" --verbose
```

- [ ] **Step 2: Rotate anything it finds.** The seeded `tk_dev_local_sandbox_key_do_not_use_in_production_...` is safe to keep (it is clearly labelled and sandbox-only), but any real Stytch, Sentry, or database credential that ever appeared must be rotated at the provider — purging history does not un-leak a key that was already pushed.

- [ ] **Step 3: Add secret scanning to CI** — a `gitleaks` step in the existing `.github/workflows` (recovered in Task 1) that fails the build on a finding.

- [ ] **Step 4: Enable GitHub push protection** on the repo settings once public.

- [ ] **Step 5: Commit.**

---

### Task 21: Make the README true

The README currently claims things that are false in code — for example it states audit writes go through an event emitter (they are a direct Prisma call in middleware at `audit.middleware.ts:41`). A public repo whose README overstates the implementation is a credibility problem, and it is the first thing a loyalty-vendor engineer will check.

- [ ] **Step 1: Audit every capability claim in `README.md`** against the code, and correct or delete each one that does not hold.

- [ ] **Step 2: Add an explicit "Project status and scope" section** stating plainly: sandbox-only, settlement is not implemented (no funds move), no double-entry ledger, MVP fraud controls, not PCI-scoped, not audited. Framing this as deliberate scope reads as engineering maturity; leaving it implied reads as overselling.

- [ ] **Step 3: Add `SECURITY.md`** with a disclosure contact and a statement that the sandbox holds no real customer data.

- [ ] **Step 4: Add a `LICENSE`.** Pick deliberately: MIT/Apache-2.0 invites adoption and portfolio credit; **AGPL or source-available (BSL) is the better choice if you still intend to sell this**, since it stops a loyalty vendor from simply lifting the adapter layer. Given the Path C strategy in `Revenue Math - Can This Be $1M`, recommend **BSL 1.1 with a 4-year Apache-2.0 conversion**, or keep the repo private and publish only the demo. Confirm the choice before committing.

- [ ] **Step 5: Add `CONTRIBUTING.md` and a `.env.example` review** — ensure every variable is documented and no example value is a real credential.

- [ ] **Step 6: Commit.**

---

### Task 22: Make the public demo safe to leave running

If a live demo is deployed alongside the public repo, it becomes an internet-facing endpoint that mints and redeems value.

- [ ] **Step 1: Force sandbox mode** — the deployed demo runs with `SANDBOX_MODE=true` and production merchant creation disabled (Task 11 Step 5).

- [ ] **Step 2: Seed only synthetic data.** No real names, emails, or merchant identities. Verify `seed.ts` contains nothing real.

- [ ] **Step 3: Add a global kill switch** — `DEMO_READONLY=true` short-circuits mint and redeem with a 503, so the demo can be frozen instantly without a redeploy.

- [ ] **Step 4: Cap the blast radius** — aggressive global rate limits, a low per-customer token cap, and a nightly reseed that wipes all demo data.

- [ ] **Step 5: Wire alerting** — Sentry is recovered in Task 1; confirm it receives events from the deployed instance and add an alert on 5xx rate.

- [ ] **Step 6: Run a final external check**

```bash
curl -s https://<demo-host>/health
curl -s -X POST https://<demo-worker>/ -d '{"method":"tools/call","params":{"name":"redeem_token","arguments":{"token_id":"x"}}}'
```

Expected: health returns real dependency status; the unauthenticated redeem returns **401**, not a redemption.

- [ ] **Step 7: Commit and publish.**

---

## Self-Review Notes

**Spec coverage:** every CRITICAL and HIGH finding from `03-Build/Production Readiness Audit - 2026-08-06.md` maps to a task — S1→T2, S2→T3, S3/S4→T7, S5→T4, S6→T6, S7→T8, S8→T5, S9→T9, rate limiting→T10, CORS/health/SIGTERM/scope-escalation→T11, M1–M5→T13, Float→T12, expiry→T14, webhook durability→T15, migrations→T16, Workers blockers→T17 (descoped deliberately), public-repo risks→T18–T22.

**Known gaps, deliberately deferred:** HMAC key rotation (no key ID on tokens — rotating invalidates all outstanding tokens) is not addressed; it needs a `keyVersion` column and is only worth doing before real money. A true double-entry ledger is deferred per Task 13. The Express→Hono migration is out of scope per Global Constraints.

**Ordering dependency:** Task 3 changes `redemptionService.redeem`'s signature and Task 4 consumes it — do not reorder. Task 8's proxy route is used by Task 9's SSE fix. Task 19 must precede making the repo public and should follow Task 1 (fewer refs to rewrite).
