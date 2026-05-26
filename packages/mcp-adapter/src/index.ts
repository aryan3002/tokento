// ============================================================
// Tokento — MCP Adapter (Cloudflare Workers)
// ============================================================
// Exposes 3 named MCP tools:
//   1. query_loyalty_tokens  → GET /v1/wallet/{customer_id}/tokens
//   2. validate_token        → POST /v1/tokens/{id}/validate
//   3. redeem_token          → POST /v1/tokens/{id}/redeem
//
// Translates MCP tool calls → TQI HTTP calls → structured responses.
// Hosted on Cloudflare Workers for sub-50ms global edge latency.

interface Env {
  API_BASE_URL: string;
  MCP_AUTH_TOKEN?: string;
}

// MCP Protocol types
interface MCPRequest {
  jsonrpc: '2.0';
  id: string | number;
  method: string;
  params?: Record<string, unknown>;
}

interface MCPResponse {
  jsonrpc: '2.0';
  id: string | number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

// Tool definitions
const TOOLS = [
  {
    name: 'query_loyalty_tokens',
    description: 'Query available loyalty tokens for a customer. Returns all active, non-expired tokens that can be applied by an AI agent during checkout.',
    inputSchema: {
      type: 'object',
      properties: {
        customer_id: { type: 'string', description: 'The customer UUID whose wallet to query.' },
        merchant_id: { type: 'string', description: 'Optional: filter by specific merchant.' },
        min_denomination: { type: 'number', description: 'Optional: minimum token value in USD.' },
        category: { type: 'string', description: 'Optional: filter by product category.' },
      },
      required: ['customer_id'],
    },
  },
  {
    name: 'validate_token',
    description: 'Validate whether a specific loyalty token can be applied to a transaction. Checks expiry, merchant match, transaction amount, and all conditions.',
    inputSchema: {
      type: 'object',
      properties: {
        token_id: { type: 'string', description: 'The token UUID to validate.' },
        merchant_id: { type: 'string', description: 'The merchant UUID for the transaction.' },
        transaction_amount: { type: 'number', description: 'The transaction amount in USD.' },
        channel: { type: 'string', description: 'Optional: the sales channel (e.g., online, in-store).' },
      },
      required: ['token_id', 'merchant_id', 'transaction_amount'],
    },
  },
  {
    name: 'redeem_token',
    description: 'Execute the redemption of a loyalty token, applying its value to the transaction. Returns the net transaction value after applying the token discount.',
    inputSchema: {
      type: 'object',
      properties: {
        token_id: { type: 'string', description: 'The token UUID to redeem.' },
        merchant_id: { type: 'string', description: 'The merchant UUID.' },
        transaction_amount: { type: 'number', description: 'The transaction amount in USD.' },
        idempotency_key: { type: 'string', description: 'Unique key to prevent duplicate redemptions.' },
      },
      required: ['token_id', 'merchant_id', 'transaction_amount', 'idempotency_key'],
    },
  },
];

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        },
      });
    }

    if (request.method !== 'POST') {
      return jsonResponse({ error: 'Method not allowed' }, 405);
    }

    try {
      const body = await request.json() as MCPRequest;

      // Handle MCP methods
      switch (body.method) {
        case 'initialize':
          return mcpResponse(body.id, {
            protocolVersion: '2024-11-05',
            capabilities: { tools: {} },
            serverInfo: { name: 'tokento', version: '0.1.0' },
          });

        case 'tools/list':
          return mcpResponse(body.id, { tools: TOOLS });

        case 'tools/call':
          return handleToolCall(body, env);

        default:
          return mcpError(body.id, -32601, `Method not found: ${body.method}`);
      }
    } catch (err) {
      return mcpError(0, -32700, 'Parse error');
    }
  },
};

async function handleToolCall(req: MCPRequest, env: Env): Promise<Response> {
  const params = req.params as { name: string; arguments: Record<string, unknown> };
  const { name, arguments: args } = params;
  const apiBase = env.API_BASE_URL;

  try {
    switch (name) {
      case 'query_loyalty_tokens': {
        const customerId = args.customer_id as string;
        const queryParams = new URLSearchParams();
        if (args.merchant_id) queryParams.set('merchantId', args.merchant_id as string);
        if (args.min_denomination) queryParams.set('minDenomination', String(args.min_denomination));
        if (args.category) queryParams.set('category', args.category as string);

        const url = `${apiBase}/api/v1/wallet/${customerId}/tokens?${queryParams}`;
        const resp = await fetch(url, {
          headers: { 'Authorization': `Bearer b2c_dev_session::${customerId}` },
        });
        const data = await resp.json();

        return mcpResponse(req.id, {
          content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
        });
      }

      case 'validate_token': {
        const url = `${apiBase}/api/v1/tokens/${args.token_id}/validate`;
        const resp = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer b2c_dev_session::mcp-agent',
          },
          body: JSON.stringify({
            transactionAmount: args.transaction_amount,
            merchantId: args.merchant_id,
            channel: args.channel,
            agentId: 'mcp-adapter',
          }),
        });
        const data = await resp.json();

        return mcpResponse(req.id, {
          content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
        });
      }

      case 'redeem_token': {
        const url = `${apiBase}/api/v1/tokens/${args.token_id}/redeem`;
        const resp = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer b2c_dev_session::mcp-agent',
          },
          body: JSON.stringify({
            transactionAmount: args.transaction_amount,
            merchantId: args.merchant_id,
            agentId: 'mcp-adapter',
            idempotencyKey: args.idempotency_key,
          }),
        });
        const data = await resp.json();

        return mcpResponse(req.id, {
          content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
        });
      }

      default:
        return mcpError(req.id, -32602, `Unknown tool: ${name}`);
    }
  } catch (err) {
    return mcpError(req.id, -32603, `Tool execution failed: ${(err as Error).message}`);
  }
}

function mcpResponse(id: string | number, result: unknown): Response {
  return jsonResponse({ jsonrpc: '2.0', id, result });
}

function mcpError(id: string | number, code: number, message: string): Response {
  return jsonResponse({ jsonrpc: '2.0', id, error: { code, message } });
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
