# Security Policy

## Scope and status

Tokento is **sandbox software under active development**. It is not PCI-scoped, has not been independently audited, and holds no real customer data. **Settlement is not implemented — no funds move.** Do not put real money or real personal data through it.

## Reporting a vulnerability

Please report security issues privately rather than opening a public issue.

- Open a [GitHub security advisory](https://github.com/aryan3002/tokento/security/advisories/new), or
- Email the maintainer via the address on the GitHub profile.

Include what you found, how to reproduce it, and what an attacker could achieve. You will get an acknowledgement within a week. There is no bug-bounty programme.

## Security posture

Fixed and covered by regression tests:

- **Authentication.** Customer and merchant sessions are validated through Stytch. Development-only session tokens are refused unless the process is both non-production *and* configured with placeholder credentials, and the API refuses to boot in production with placeholder credentials.
- **Authorization.** A token may only be redeemed by its owner, checked before any other work, including before the duplicate-redemption path that would otherwise leak another customer's record.
- **Agent identity.** MCP tools take a customer wallet session token and forward it verbatim. The adapter cannot name a customer; `customer_id` is not an input to any tool.
- **Tenant isolation.** Sandbox and production data never mix, enforced at authentication and required by the type system in every service. Idempotency keys are scoped per tenant. The event stream never broadcasts an event it cannot scope to one merchant.
- **Token integrity.** Tokens are HMAC-SHA256 signed with a per-merchant derived key, verified at validate and redeem. The signature covers the spend floor and agent-presentability, so neither can be altered in the database without detection.
- **Credentials.** API keys are stored hashed, never in plaintext, and never reach the browser — the dashboard proxies through a server-side route.
- **Rate limiting.** Keyed on the authenticated principal. Value-moving operations fail closed if the limiter is unavailable.

## Known limitations

These are understood and deliberately unaddressed at this stage:

- **No transactional outbox.** A crash between the redemption commit and the event listener loses that webhook.
- **No HMAC key rotation.** Tokens carry no key version; rotating the master key invalidates every outstanding token.
- **Audit writes are fire-and-forget.** They do not block redemption, so a hard crash can drop recent entries.
- **No fraud controls beyond rate limiting.** No velocity checks or risk scoring.
- **Merchant self-registration** should be disabled or invite-gated in any deployment (`SIGNUP_INVITE_CODE`).

## Deployment requirements

A deployment MUST set: `HMAC_MASTER_KEY` (the API refuses to start in production without it), real `STYTCH_*` credentials, `ALLOWED_ORIGINS` (CORS denies unlisted origins in production), and `TOKENTO_API_KEY` server-side only — never as a `NEXT_PUBLIC_*` variable.
