# Tokento — The Loyalty Layer for AI Shopping Agents

> Programmable merchant value tokens for the agentic commerce economy.

## What is Tokento?

Tokento is infrastructure that makes merchant loyalty programs accessible to AI agents. Merchants issue structured value tokens via API. Tokens live in a platform-managed customer wallet, are queryable by any AI agent via the **Token Query Interface (TQI)**, and are redeemable at checkout automatically.

## Architecture

```
Merchant Dashboard (Next.js)
         ↓
    API Gateway (Express + Auth)
    ├── Token Issuance Service
    ├── Wallet Service
    ├── Validation Service
    ├── Redemption Service
    ├── Merchant Config Service
    └── Webhook Service
         ↓
    MCP Adapter (Cloudflare Workers)
    └── Claude / ChatGPT / agents query here
         ↓
    PostgreSQL + Redis
```

## Quick Start

### Prerequisites
- Node.js ≥ 20
- pnpm ≥ 9
- Docker (for Postgres + Redis)

### Setup

```bash
# 1. Install dependencies
pnpm install

# 2. Copy environment variables
cp .env.example .env

# 3. Start local databases
docker compose up -d

# 4. Generate Prisma client & push schema
pnpm db:generate
pnpm db:push

# 5. Seed test data
pnpm db:seed

# 6. Start development servers
pnpm dev
```

The API will be running at `http://localhost:4000`.

### Test the API

```bash
# Health check
curl http://localhost:4000/health

# Register a merchant (returns API key)
curl -X POST http://localhost:4000/api/v1/merchants \
  -H "Content-Type: application/json" \
  -d '{"name": "My Coffee Shop", "email": "demo@coffee.com"}'

# Create an earn rule
curl -X POST http://localhost:4000/api/v1/merchants/me/earn-rules \
  -H "X-API-Key: YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"name": "Spend $25 Get $5", "spendThreshold": 25, "tokenDenomination": 5}'

# Mint a token
curl -X POST http://localhost:4000/api/v1/tokens/mint \
  -H "X-API-Key: YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"merchantId": "...", "customerId": "...", "transactionAmount": 30, "earnRuleId": "...", "idempotencyKey": "unique-key-1"}'

# Query wallet (as agent)
curl http://localhost:4000/api/v1/wallet/CUSTOMER_ID/tokens \
  -H "Authorization: Bearer CUSTOMER_ID"

# Validate a token
curl -X POST http://localhost:4000/api/v1/tokens/TOKEN_ID/validate \
  -H "Authorization: Bearer agent-token" \
  -H "Content-Type: application/json" \
  -d '{"transactionAmount": 30, "merchantId": "..."}'

# Redeem a token
curl -X POST http://localhost:4000/api/v1/tokens/TOKEN_ID/redeem \
  -H "Authorization: Bearer agent-token" \
  -H "Content-Type: application/json" \
  -d '{"transactionAmount": 30, "merchantId": "...", "idempotencyKey": "redeem-1"}'
```

## Packages

| Package | Description |
|---------|-------------|
| `packages/api` | Express API server with all core services |
| `packages/mcp-adapter` | Cloudflare Workers MCP adapter (3 tools) |
| `packages/dashboard` | Next.js merchant dashboard (MVP: 1 page) |
| `packages/checkout-widget` | Vanilla TS checkout widget (<10KB) |
| `packages/shared` | Shared types, Zod schemas, constants |

## MCP Tools

| Tool | Description |
|------|-------------|
| `query_loyalty_tokens` | Returns available loyalty tokens for a customer |
| `validate_token` | Validates a token against transaction context |
| `redeem_token` | Executes redemption, returns net transaction value |

## API Endpoints

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/v1/merchants` | None | Register merchant |
| GET | `/v1/merchants/me` | API Key | Get merchant info |
| PUT | `/v1/merchants/me/config` | API Key | Update config |
| POST | `/v1/merchants/me/earn-rules` | API Key | Create earn rule |
| GET | `/v1/merchants/me/earn-rules` | API Key | List earn rules |
| POST | `/v1/tokens/mint` | API Key | Mint a token |
| GET | `/v1/wallet/{id}/tokens` | Bearer | Query wallet (TQI) |
| POST | `/v1/tokens/{id}/validate` | Bearer | Validate token |
| POST | `/v1/tokens/{id}/redeem` | Bearer | Redeem token |
| GET | `/v1/redemptions` | API Key | Redemption history |

## Tech Stack

- **Runtime**: Node.js + TypeScript
- **API**: Express
- **ORM**: Prisma
- **Database**: PostgreSQL
- **Cache**: Redis
- **MCP**: Cloudflare Workers
- **Validation**: Zod
- **Logging**: Pino
- **Monorepo**: pnpm workspaces + Turborepo

## License

Private — All rights reserved.
