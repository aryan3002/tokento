import fs from 'fs';
import path from 'path';
import { z } from 'zod';
import { createDocument } from 'zod-openapi';
import YAML from 'yaml';
import {
  CreateApiKeySchema,
  CreateEarnRuleSchema,
  CreateMerchantSchema,
  CreateWebhookEndpointSchema,
  MintTokenSchema,
  PaginationSchema,
  RedeemTokenSchema,
  TokenStatus,
  TokenType,
  UpdateEarnRuleSchema,
  UpdateMerchantConfigSchema,
  ValidateTokenSchema,
  WalletQuerySchema,
} from '@tokento/shared';

const DateTimeString = z.string().datetime();
const UUIDString = z.string().uuid();

const ErrorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.record(z.unknown()).optional(),
  }),
  requestId: z.string(),
});

const TokenSchema = z.object({
  id: UUIDString,
  merchantId: UUIDString,
  customerId: UUIDString,
  earnRuleId: UUIDString,
  denomination: z.number(),
  tokenType: z.nativeEnum(TokenType),
  status: z.nativeEnum(TokenStatus),
  signature: z.string(),
  idempotencyKey: z.string(),
  categoryRestriction: z.string().nullable(),
  channelRestriction: z.string().nullable(),
  stackabilityFlag: z.boolean(),
  agentPresentableFlag: z.boolean(),
  minimumTransactionFloor: z.number(),
  issuedAt: DateTimeString,
  expiryAt: DateTimeString,
  redeemedAt: DateTimeString.nullable(),
  createdAt: DateTimeString,
  updatedAt: DateTimeString,
  isSandbox: z.boolean(),
});

const MerchantSchema = z.object({
  id: UUIDString,
  name: z.string(),
  email: z.string().email(),
  agentOptIn: z.boolean(),
  settlementType: z.string(),
  settlementTiming: z.string(),
  webhookUrl: z.string().nullable(),
  webhookSecret: z.string().nullable().optional(),
  isSandbox: z.boolean(),
  createdAt: DateTimeString,
  updatedAt: DateTimeString,
});

const EarnRuleSchema = z.object({
  id: UUIDString,
  merchantId: UUIDString,
  name: z.string(),
  spendThreshold: z.number(),
  tokenDenomination: z.number(),
  expiryDays: z.number().int(),
  categoryRestriction: z.string().nullable(),
  channelRestriction: z.string().nullable(),
  stackabilityFlag: z.boolean(),
  agentPresentableFlag: z.boolean(),
  minimumTransactionFloor: z.number(),
  isActive: z.boolean(),
  createdAt: DateTimeString,
  updatedAt: DateTimeString,
});

const RedemptionSchema = z.object({
  id: UUIDString,
  tokenId: UUIDString,
  merchantId: UUIDString,
  customerId: UUIDString,
  transactionAmount: z.number(),
  tokenDenomination: z.number(),
  netValue: z.number(),
  agentId: z.string().nullable(),
  settlementRef: z.string(),
  redeemedAt: DateTimeString,
});

const WebhookEndpointSchema = z.object({
  id: UUIDString,
  merchantId: UUIDString,
  url: z.string().url(),
  secret: z.string(),
  events: z.array(z.string()),
  isActive: z.boolean(),
  createdAt: DateTimeString,
  updatedAt: DateTimeString,
});

const MintTokenResponseSchema = z.object({
  token: TokenSchema,
  walletCreated: z.boolean(),
});

const WalletQueryResponseSchema = z.object({
  customerId: UUIDString,
  tokens: z.array(TokenSchema),
  totalValue: z.number(),
});

const ValidateTokenResponseSchema = z.object({
  valid: z.boolean(),
  tokenId: UUIDString,
  denomination: z.number(),
  reasonCode: z.string().nullable(),
  reasonMessage: z.string().nullable(),
});

const RedeemTokenResponseSchema = z.object({
  redemptionId: UUIDString,
  tokenId: UUIDString,
  netTransactionValue: z.number(),
  tokenDenomination: z.number(),
  settlementReference: z.string(),
  alreadyRedeemed: z.boolean(),
});

const CreateMerchantResponseSchema = z.object({
  merchant: MerchantSchema,
  apiKey: z.string(),
});

const ApiKeyListItemSchema = z.object({
  id: UUIDString,
  keyPrefix: z.string(),
  scopes: z.array(z.string()),
  rateLimit: z.number().int(),
  isSandbox: z.boolean(),
  isActive: z.boolean(),
  lastUsedAt: DateTimeString.nullable(),
  createdAt: DateTimeString,
  expiresAt: DateTimeString.nullable(),
});

const CreateApiKeyResponseSchema = z.object({
  apiKey: z.string(),
  keyPrefix: z.string(),
});

const SessionJwtRequestSchema = z.object({
  sessionJwt: z.string().min(1),
});

const B2BAuthResponseSchema = z.object({
  merchantId: z.string(),
  memberId: z.string(),
  organizationId: z.string(),
  fallback: z.boolean(),
});

const B2CAuthResponseSchema = z.object({
  customerId: z.string(),
  userId: z.string(),
  fallback: z.boolean(),
});

const DevB2BSessionSchema = z.object({
  sessionJwt: z.string(),
  merchantId: z.string(),
  fallback: z.literal(true),
  warning: z.string(),
});

const document = createDocument({
  openapi: '3.1.0',
  info: {
    title: 'Tokento API',
    version: '0.1.0',
    description: 'Tokento V1 API contract for merchant issuance, wallet query, validation, redemption, and dashboard operations.',
  },
  servers: [
    { url: 'http://localhost:4000', description: 'Local development server' },
  ],
  tags: [
    { name: 'Health' },
    { name: 'Tokens' },
    { name: 'Wallet' },
    { name: 'Validation' },
    { name: 'Redemption' },
    { name: 'Merchants' },
    { name: 'Webhooks' },
    { name: 'Auth' },
    { name: 'Events' },
  ],
  components: {
    securitySchemes: {
      apiKeyAuth: {
        type: 'apiKey',
        in: 'header',
        name: 'X-API-Key',
      },
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
      },
    },
  },
  paths: {
    '/health': {
      get: {
        tags: ['Health'],
        summary: 'Health check',
        responses: {
          '200': {
            description: 'API is healthy',
            content: {
              'application/json': {
                schema: z.object({
                  status: z.literal('ok'),
                  service: z.literal('tokento-api'),
                  timestamp: DateTimeString,
                }),
              },
            },
          },
        },
      },
    },
    '/api/v1/tokens/mint': {
      post: {
        tags: ['Tokens'],
        summary: 'Mint token',
        security: [{ apiKeyAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: MintTokenSchema },
          },
        },
        responses: {
          '201': {
            description: 'Token minted',
            content: {
              'application/json': { schema: MintTokenResponseSchema },
            },
          },
          '400': { description: 'Validation error', content: { 'application/json': { schema: ErrorResponseSchema } } },
          '401': { description: 'Auth error', content: { 'application/json': { schema: ErrorResponseSchema } } },
          '403': { description: 'Forbidden', content: { 'application/json': { schema: ErrorResponseSchema } } },
        },
      },
    },
    '/api/v1/tokens/{id}': {
      get: {
        tags: ['Tokens'],
        summary: 'Get token by id',
        security: [{ apiKeyAuth: [] }],
        requestParams: {
          path: z.object({ id: UUIDString }),
        },
        responses: {
          '200': { description: 'Token found', content: { 'application/json': { schema: TokenSchema } } },
          '401': { description: 'Auth error', content: { 'application/json': { schema: ErrorResponseSchema } } },
          '403': { description: 'Forbidden', content: { 'application/json': { schema: ErrorResponseSchema } } },
          '404': { description: 'Not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
        },
      },
    },
    '/api/v1/wallet/{customerId}/tokens': {
      get: {
        tags: ['Wallet'],
        summary: 'Query wallet tokens',
        security: [{ bearerAuth: [] }],
        requestParams: {
          path: z.object({ customerId: UUIDString }),
          query: WalletQuerySchema,
        },
        responses: {
          '200': { description: 'Wallet tokens', content: { 'application/json': { schema: WalletQueryResponseSchema } } },
          '401': { description: 'Auth error', content: { 'application/json': { schema: ErrorResponseSchema } } },
          '403': { description: 'Forbidden', content: { 'application/json': { schema: ErrorResponseSchema } } },
        },
      },
    },
    '/api/v1/tokens/{id}/validate': {
      post: {
        tags: ['Validation'],
        summary: 'Validate token for redemption',
        security: [{ bearerAuth: [] }],
        requestParams: {
          path: z.object({ id: UUIDString }),
        },
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: ValidateTokenSchema },
          },
        },
        responses: {
          '200': { description: 'Validation result', content: { 'application/json': { schema: ValidateTokenResponseSchema } } },
          '400': { description: 'Validation error', content: { 'application/json': { schema: ErrorResponseSchema } } },
          '401': { description: 'Auth error', content: { 'application/json': { schema: ErrorResponseSchema } } },
        },
      },
    },
    '/api/v1/tokens/{id}/redeem': {
      post: {
        tags: ['Redemption'],
        summary: 'Redeem token',
        security: [{ bearerAuth: [] }],
        requestParams: {
          path: z.object({ id: UUIDString }),
        },
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: RedeemTokenSchema },
          },
        },
        responses: {
          '200': { description: 'Redemption result', content: { 'application/json': { schema: RedeemTokenResponseSchema } } },
          '400': { description: 'Validation error', content: { 'application/json': { schema: ErrorResponseSchema } } },
          '401': { description: 'Auth error', content: { 'application/json': { schema: ErrorResponseSchema } } },
        },
      },
    },
    '/api/v1/redemptions': {
      get: {
        tags: ['Redemption'],
        summary: 'List merchant redemptions',
        security: [{ apiKeyAuth: [] }],
        requestParams: {
          query: PaginationSchema,
        },
        responses: {
          '200': {
            description: 'Paginated redemption list',
            content: {
              'application/json': {
                schema: z.object({
                  data: z.array(RedemptionSchema),
                  page: z.number().int(),
                  limit: z.number().int(),
                  total: z.number().int(),
                  totalPages: z.number().int(),
                }),
              },
            },
          },
          '401': { description: 'Auth error', content: { 'application/json': { schema: ErrorResponseSchema } } },
        },
      },
    },
    '/api/v1/merchants': {
      post: {
        tags: ['Merchants'],
        summary: 'Create merchant',
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: CreateMerchantSchema },
          },
        },
        responses: {
          '201': { description: 'Merchant created', content: { 'application/json': { schema: CreateMerchantResponseSchema } } },
          '409': { description: 'Merchant already exists', content: { 'application/json': { schema: ErrorResponseSchema } } },
        },
      },
    },
    '/api/v1/merchants/me': {
      get: {
        tags: ['Merchants'],
        summary: 'Get merchant profile',
        security: [{ apiKeyAuth: [] }, { bearerAuth: [] }],
        responses: {
          '200': { description: 'Merchant profile', content: { 'application/json': { schema: MerchantSchema } } },
          '401': { description: 'Auth error', content: { 'application/json': { schema: ErrorResponseSchema } } },
        },
      },
    },
    '/api/v1/merchants/me/config': {
      put: {
        tags: ['Merchants'],
        summary: 'Update merchant config',
        security: [{ apiKeyAuth: [] }, { bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: UpdateMerchantConfigSchema },
          },
        },
        responses: {
          '200': { description: 'Updated merchant', content: { 'application/json': { schema: MerchantSchema } } },
          '401': { description: 'Auth error', content: { 'application/json': { schema: ErrorResponseSchema } } },
        },
      },
    },
    '/api/v1/merchants/me/earn-rules': {
      get: {
        tags: ['Merchants'],
        summary: 'List earn rules',
        security: [{ apiKeyAuth: [] }, { bearerAuth: [] }],
        responses: {
          '200': { description: 'Earn rules', content: { 'application/json': { schema: z.array(EarnRuleSchema) } } },
          '401': { description: 'Auth error', content: { 'application/json': { schema: ErrorResponseSchema } } },
        },
      },
      post: {
        tags: ['Merchants'],
        summary: 'Create earn rule',
        security: [{ apiKeyAuth: [] }, { bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: CreateEarnRuleSchema },
          },
        },
        responses: {
          '201': { description: 'Earn rule created', content: { 'application/json': { schema: EarnRuleSchema } } },
          '401': { description: 'Auth error', content: { 'application/json': { schema: ErrorResponseSchema } } },
        },
      },
    },
    '/api/v1/merchants/me/earn-rules/{ruleId}': {
      put: {
        tags: ['Merchants'],
        summary: 'Update earn rule',
        security: [{ apiKeyAuth: [] }, { bearerAuth: [] }],
        requestParams: {
          path: z.object({ ruleId: UUIDString }),
        },
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: UpdateEarnRuleSchema },
          },
        },
        responses: {
          '200': { description: 'Earn rule updated', content: { 'application/json': { schema: EarnRuleSchema } } },
          '401': { description: 'Auth error', content: { 'application/json': { schema: ErrorResponseSchema } } },
          '404': { description: 'Rule not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
        },
      },
    },
    '/api/v1/merchants/me/tokens': {
      get: {
        tags: ['Merchants'],
        summary: 'List merchant tokens',
        security: [{ apiKeyAuth: [] }, { bearerAuth: [] }],
        responses: {
          '200': { description: 'Merchant tokens', content: { 'application/json': { schema: z.array(TokenSchema) } } },
          '401': { description: 'Auth error', content: { 'application/json': { schema: ErrorResponseSchema } } },
        },
      },
    },
    '/api/v1/merchants/me/redemptions': {
      get: {
        tags: ['Merchants'],
        summary: 'List merchant redemptions',
        security: [{ apiKeyAuth: [] }, { bearerAuth: [] }],
        responses: {
          '200': { description: 'Merchant redemptions', content: { 'application/json': { schema: z.array(RedemptionSchema) } } },
          '401': { description: 'Auth error', content: { 'application/json': { schema: ErrorResponseSchema } } },
        },
      },
    },
    '/api/v1/merchants/me/api-keys': {
      get: {
        tags: ['Merchants'],
        summary: 'List API keys',
        security: [{ apiKeyAuth: [] }, { bearerAuth: [] }],
        responses: {
          '200': { description: 'API keys', content: { 'application/json': { schema: z.array(ApiKeyListItemSchema) } } },
          '401': { description: 'Auth error', content: { 'application/json': { schema: ErrorResponseSchema } } },
        },
      },
      post: {
        tags: ['Merchants'],
        summary: 'Create API key',
        security: [{ apiKeyAuth: [] }, { bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: CreateApiKeySchema },
          },
        },
        responses: {
          '201': { description: 'API key created', content: { 'application/json': { schema: CreateApiKeyResponseSchema } } },
          '401': { description: 'Auth error', content: { 'application/json': { schema: ErrorResponseSchema } } },
        },
      },
    },
    '/api/v1/merchants/me/api-keys/{keyId}': {
      delete: {
        tags: ['Merchants'],
        summary: 'Revoke API key',
        security: [{ apiKeyAuth: [] }, { bearerAuth: [] }],
        requestParams: {
          path: z.object({ keyId: UUIDString }),
        },
        responses: {
          '204': { description: 'API key revoked' },
          '401': { description: 'Auth error', content: { 'application/json': { schema: ErrorResponseSchema } } },
          '404': { description: 'Key not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
        },
      },
    },
    '/api/v1/merchants/me/webhooks': {
      get: {
        tags: ['Webhooks'],
        summary: 'List webhook endpoints',
        security: [{ apiKeyAuth: [] }, { bearerAuth: [] }],
        responses: {
          '200': { description: 'Webhook endpoints', content: { 'application/json': { schema: z.array(WebhookEndpointSchema) } } },
          '401': { description: 'Auth error', content: { 'application/json': { schema: ErrorResponseSchema } } },
        },
      },
      post: {
        tags: ['Webhooks'],
        summary: 'Create webhook endpoint',
        security: [{ apiKeyAuth: [] }, { bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: CreateWebhookEndpointSchema },
          },
        },
        responses: {
          '201': { description: 'Webhook endpoint created', content: { 'application/json': { schema: WebhookEndpointSchema } } },
          '401': { description: 'Auth error', content: { 'application/json': { schema: ErrorResponseSchema } } },
        },
      },
    },
    '/api/v1/merchants/me/webhooks/{endpointId}': {
      delete: {
        tags: ['Webhooks'],
        summary: 'Delete webhook endpoint',
        security: [{ apiKeyAuth: [] }, { bearerAuth: [] }],
        requestParams: {
          path: z.object({ endpointId: UUIDString }),
        },
        responses: {
          '204': { description: 'Webhook endpoint deleted' },
          '401': { description: 'Auth error', content: { 'application/json': { schema: ErrorResponseSchema } } },
          '404': { description: 'Endpoint not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
        },
      },
    },
    '/api/v1/auth/b2b/authenticate': {
      post: {
        tags: ['Auth'],
        summary: 'Authenticate B2B session JWT',
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: SessionJwtRequestSchema },
          },
        },
        responses: {
          '200': { description: 'B2B session auth context', content: { 'application/json': { schema: B2BAuthResponseSchema } } },
          '401': { description: 'Invalid session', content: { 'application/json': { schema: ErrorResponseSchema } } },
        },
      },
    },
    '/api/v1/auth/b2c/authenticate': {
      post: {
        tags: ['Auth'],
        summary: 'Authenticate B2C session JWT',
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: SessionJwtRequestSchema },
          },
        },
        responses: {
          '200': { description: 'B2C session auth context', content: { 'application/json': { schema: B2CAuthResponseSchema } } },
          '401': { description: 'Invalid session', content: { 'application/json': { schema: ErrorResponseSchema } } },
        },
      },
    },
    '/api/v1/auth/b2b/dev-session': {
      get: {
        tags: ['Auth'],
        summary: 'Create dev fallback B2B session JWT',
        requestParams: {
          query: z.object({ merchantId: z.string().optional() }),
        },
        responses: {
          '200': { description: 'Dev fallback session', content: { 'application/json': { schema: DevB2BSessionSchema } } },
          '403': { description: 'Dev fallback disabled', content: { 'application/json': { schema: ErrorResponseSchema } } },
        },
      },
    },
    '/api/v1/events/stream': {
      get: {
        tags: ['Events'],
        summary: 'SSE stream for merchant events',
        description: 'Returns a text/event-stream payload. Authenticate with `apiKey` query parameter or `sessionJwt` query parameter.',
        requestParams: {
          query: z.object({
            apiKey: z.string().optional(),
            sessionJwt: z.string().optional(),
          }),
        },
        responses: {
          '200': {
            description: 'SSE stream connected',
            content: {
              'text/event-stream': {
                schema: z.string(),
              },
            },
          },
          '401': { description: 'Auth error', content: { 'application/json': { schema: ErrorResponseSchema } } },
        },
      },
    },
  },
});

const outputPath = path.resolve(__dirname, '..', 'openapi.yaml');
const yaml = YAML.stringify(document, {
  lineWidth: 120,
  minContentWidth: 20,
});

fs.writeFileSync(outputPath, yaml, 'utf8');
console.log(`Wrote ${outputPath}`);
