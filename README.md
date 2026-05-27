# Tokento — The Loyalty Layer for AI Shopping Agents

> **Programmable merchant value tokens for the agentic commerce economy.** When an AI agent buys on your behalf, Tokento makes sure the loyalty value follows you through the transaction — not just the dollars.

[![MCP Ready](https://img.shields.io/badge/MCP-Day%201-blueviolet)](https://modelcontextprotocol.io/)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue)](https://www.typescriptlang.org/)
[![Node 20+](https://img.shields.io/badge/node-20%2B-green)](https://nodejs.org/)
[![Status](https://img.shields.io/badge/status-active%20build-success)]()

---

## The Problem

Agentic commerce is here. Stripe shipped the Agentic Commerce Protocol with OpenAI. Shopify rolled out agentic storefronts to millions of merchants. AI agents now research, compare, and complete purchases on behalf of consumers.

**One thing breaks at every agentic checkout: loyalty.**

Reward programs were designed for human shoppers clicking a "redeem points" button. When a third-party agent (Claude, ChatGPT, an autonomous shopping assistant) executes the purchase, the loyalty layer becomes invisible. Customers lose rewards. Merchants lose retention. Existing loyalty platforms (Talon.One, Yotpo, LoyaltyLion) remain UI-first — they have no machine-readable interface.

**Tokento is the missing infrastructure.**

---

## What Tokento Does

Tokento makes merchant loyalty programs natively accessible to AI agents:

1. **Merchants issue** structured value tokens via API at the moment of transaction
2. **Tokens live in** a platform-managed customer wallet, cross-merchant by design
3. **AI agents query** the wallet through the **Token Query Interface (TQI)** — three endpoints, protocol-agnostic
4. **Tokens redeem** atomically at checkout with full audit trail, idempotency, and settlement

```
┌──────────────┐    1. mint token    ┌─────────────────────────────────────────┐
│  Merchant    │ ──────────────────► │              TOKENTO PLATFORM           │
└──────────────┘                     │                                         │
                                     │   ┌─────────────────────────────────┐   │
┌──────────────┐  2. query / redeem  │   │  Token Query Interface (TQI)    │   │
│  AI Agent    │ ◄─────────────────► │   │  • GET  /wallet/{id}/tokens     │   │
│ (Claude /    │                     │   │  • POST /tokens/{id}/validate   │   │
│  ChatGPT /   │  via MCP adapter    │   │  • POST /tokens/{id}/redeem     │   │
│  custom)     │                     │   └─────────────────────────────────┘   │
└──────────────┘                     │                                         │
                                     │   Wallet · Validation · Redemption ·    │
                                     │   Merchant Config · Webhooks · Audit    │
                                     └─────────────────────────────────────────┘
                                                       │
                                                       ▼
                                              PostgreSQL + Redis
```

---

## Architecture (4-Layer Model)

| Layer | What it does |
|---|---|
| **1. Merchant Issuance** | Merchants `POST /v1/tokens/mint` with transaction context + earn-rule reference. HMAC-SHA256 signed, idempotent. |
| **2. Platform Core** | The stable internal contract — Token Issuance, Wallet, **TQI**, Merchant Config. Source of truth. |
| **3. Agent Interoperability (Adapters)** | Thin protocol adapters layered over TQI: MCP (Day 1), x402, AP2 / OpenAI ACP (later). Adapters translate to TQI — never the other way around. |
| **4. Settlement** | Daily batch in MVP, real-time in v2. Ledger + disbursement pluggable. |

**Why this design wins:** Adding a new agent protocol is an *adapter problem*, never an *architecture problem*. The TQI is the stable contract.

---

## The TQI — Three Endpoints

The whole agent-side surface area is three endpoints. That's the point.

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/v1/wallet/{customerId}/tokens` | Returns ACTIVE non-expired tokens, filterable |
| `POST` | `/v1/tokens/{id}/validate` | Presentability check with detailed failure reasons |
| `POST` | `/v1/tokens/{id}/redeem` | Atomic, idempotent redemption, returns net transaction value |

Every agent protocol (MCP, x402, AP2) talks to these three endpoints. Period.

---

## MCP Tools (Day-1 Adapter)

The MCP adapter exposes 3 tools that any MCP-compatible agent can call:

| Tool | What it does |
|---|---|
| `query_loyalty_tokens` | Returns available loyalty tokens for a customer |
| `validate_token` | Validates a token against transaction context |
| `redeem_token` | Executes redemption, returns net transaction value |

Built as a [Cloudflare Worker](https://workers.cloudflare.com/) for global low-latency agent access.

---

## Packages

This is a pnpm + Turborepo monorepo:

| Package | Stack | Role |
|---|---|---|
| `packages/api` | Express · Prisma · Pino · Zod | 7 services + 7 middleware. Port 4000. |
| `packages/mcp-adapter` | Cloudflare Workers · Wrangler | 3 MCP tools. Port 8787 (local). |
| `packages/dashboard` | Next.js · Tailwind | Merchant dashboard. Port 3100. |
| `packages/checkout-widget` | Vanilla TS, <10KB | Embeddable checkout handoff widget. |
| `packages/shared` | TypeScript · Zod | Shared types, schemas, constants. |

---

## Engineering Invariants

- **HMAC-SHA256 signing.** Every token carries a signature derived from `HMAC_MASTER_KEY` + merchant ID. Verified at both validate and redeem.
- **Idempotency by default.** `mint` and `redeem` accept idempotency keys; `idempotency_records` table holds keys for 24 hours. Middleware handles it generically.
- **Sandbox isolation.** Sandbox API keys cannot see production data and vice versa. Enforced in middleware.
- **Async audit log.** Audit writes go through an event emitter — they never block the redemption path.
- **Wallet cache.** Redis-backed, 60s TTL on wallet queries. Invalidated on mint/redeem.

---

## Quick Start

### Prerequisites
- Node.js ≥ 20
- pnpm ≥ 9
- Docker (for Postgres + Redis)

### Setup

```bash
# Install dependencies
pnpm install

# Environment
cp .env.example .env

# Start local Postgres 16 + Redis 7
docker compose up -d

# Database
pnpm db:generate
pnpm db:push
pnpm db:seed              # Coffee Co. merchant, API key, 2 earn rules, 3 active tokens

# Dev servers (turbo dev across all packages)
pnpm dev
```

API → `http://localhost:4000`
MCP adapter → `http://localhost:8787`
Dashboard → `http://localhost:3100`

### Try It

```bash
# Health check
curl http://localhost:4000/health

# Register a merchant (returns API key)
curl -X POST http://localhost:4000/api/v1/merchants \
  -H "Content-Type: application/json" \
  -d '{"name": "My Coffee Shop", "email": "demo@coffee.com"}'

# Mint a token
curl -X POST http://localhost:4000/api/v1/tokens/mint \
  -H "X-API-Key: YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"merchantId": "...", "customerId": "...", "transactionAmount": 30, "earnRuleId": "...", "idempotencyKey": "unique-key-1"}'

# Query wallet (TQI — as an agent)
curl http://localhost:4000/api/v1/wallet/CUSTOMER_ID/tokens \
  -H "Authorization: Bearer CUSTOMER_ID"

# Redeem a token
curl -X POST http://localhost:4000/api/v1/tokens/TOKEN_ID/redeem \
  -H "Authorization: Bearer agent-token" \
  -H "Content-Type: application/json" \
  -d '{"transactionAmount": 30, "merchantId": "...", "idempotencyKey": "redeem-1"}'
```

### Claude Desktop / MCP Bridge

`mcp-proxy.js` is a stdio↔HTTP bridge that lets Claude Desktop talk to the local MCP adapter. Wire it into Claude Desktop's MCP config to demo end-to-end:

```json
{
  "mcpServers": {
    "tokento": {
      "command": "node",
      "args": ["/path/to/Token/mcp-proxy.js"]
    }
  }
}
```

---

## API Reference

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| POST | `/v1/merchants` | None | Register merchant |
| GET | `/v1/merchants/me` | API Key | Get merchant info |
| PUT | `/v1/merchants/me/config` | API Key | Update config |
| POST | `/v1/merchants/me/earn-rules` | API Key | Create earn rule |
| GET | `/v1/merchants/me/earn-rules` | API Key | List earn rules |
| POST | `/v1/tokens/mint` | API Key | Mint a token |
| GET | `/v1/wallet/{id}/tokens` | Bearer | Query wallet (TQI) |
| POST | `/v1/tokens/{id}/validate` | Bearer | Validate token (TQI) |
| POST | `/v1/tokens/{id}/redeem` | Bearer | Redeem token (TQI) |
| GET | `/v1/redemptions` | API Key | Redemption history |

---

## Tech Stack

- **Language:** TypeScript (strict)
- **Runtime:** Node.js 20+
- **API:** Express
- **ORM:** Prisma
- **Database:** PostgreSQL 16
- **Cache:** Redis 7
- **Agent Layer:** Cloudflare Workers + [@modelcontextprotocol/sdk](https://github.com/modelcontextprotocol/typescript-sdk)
- **Validation:** Zod
- **Logging:** Pino (structured)
- **Observability:** Sentry · Honeycomb / Grafana
- **Auth:** Stytch (Day 1) + HMAC-signed tokens
- **Monorepo:** pnpm 9 workspaces + Turborepo

---

## Why This Matters

> McKinsey estimates the agentic commerce opportunity at **$3T–$5T by 2030**.

The new winners aren't the agents themselves — they're the protocols and the missing-but-needed infrastructure underneath them. Stripe owns payments. Shopify owns storefronts. The loyalty/value layer doesn't have an owner yet.

Tokento is building toward becoming that layer.

---

## Companion Project

**[MCPaaS](https://github.com/aryan3002/MCPass)** — A hosted Model Context Protocol platform. Where Tokento sits at the loyalty/value layer of agentic commerce, MCPaaS sits at the catalog/tool-access layer. Together they cover both halves of the merchant-facing agentic stack.

---

## About the Author

**Aryan Tripathi** — CS Senior at Arizona State University (May 2026), 4+1 MS CS candidate (AI concentration). Building in the agentic commerce + AI infrastructure space.

- 🔗 [LinkedIn](https://linkedin.com/in/aryan-tripathi-9254a611b)
- 💻 [GitHub](https://github.com/aryan3002)
- 📧 atripa38@asu.edu

---

## License

Private — All rights reserved.
