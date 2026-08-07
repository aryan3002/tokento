import { describe, expect, it, vi } from 'vitest';
import worker from './index';

describe('mcp adapter worker', () => {
  it('returns method not allowed for non-POST requests', async () => {
    const req = new Request('http://localhost:8787', { method: 'GET' });
    const res = await worker.fetch(req, { API_BASE_URL: 'http://localhost:4000' });
    expect(res.status).toBe(405);
  });

  it('lists available tools', async () => {
    const req = new Request('http://localhost:8787', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/list',
      }),
    });

    const res = await worker.fetch(req, { API_BASE_URL: 'http://localhost:4000' });
    expect(res.status).toBe(200);

    const body = await res.json() as {
      result?: { tools?: Array<{ name: string }> };
    };

    expect(Array.isArray(body.result?.tools)).toBe(true);
    const names = body.result?.tools?.map((tool) => tool.name) || [];
    expect(names).toContain('query_loyalty_tokens');
    expect(names).toContain('validate_token');
    expect(names).toContain('redeem_token');
  });

  it('returns MCP method-not-found for unknown method', async () => {
    const req = new Request('http://localhost:8787', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'unknown_method',
      }),
    });

    const res = await worker.fetch(req, { API_BASE_URL: 'http://localhost:4000' });
    const body = await res.json() as {
      error?: { code?: number };
    };

    expect(res.status).toBe(200);
    expect(body.error?.code).toBe(-32601);
  });
});

describe('identity is taken from the wallet token, never from a tool argument', () => {
  const env = { API_BASE_URL: 'http://localhost:4000' } as never;

  function call(name: string, args: Record<string, unknown>) {
    return new Request('http://worker/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
    });
  }

  it('refuses a tool call with no wallet_token', async () => {
    const res = await worker.fetch(call('redeem_token', {
      token_id: 't1', merchant_id: 'm1', transaction_amount: 10, idempotency_key: 'k',
    }), env);
    const body = await res.json() as { result: { isError: boolean; content: { text: string }[] } };
    expect(body.result.isError).toBe(true);
    expect(body.result.content[0].text).toMatch(/wallet_token/);
  });

  it('forwards the wallet token verbatim and never synthesises a dev session', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ tokens: [] }), { headers: { 'Content-Type': 'application/json' } }),
    );

    await worker.fetch(call('query_loyalty_tokens', { wallet_token: 'session-abc' }), env);

    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const auth = (init.headers as Record<string, string>)['Authorization'];
    expect(auth).toBe('Bearer session-abc');
    expect(auth).not.toContain('dev_session');
    // The customer is resolved from the session, so no customer id travels in the URL.
    expect(url).toContain('/wallet/me/tokens');
    fetchSpy.mockRestore();
  });

  it('does not advertise customer_id as an input on any tool', async () => {
    const res = await worker.fetch(new Request('http://worker/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }),
    }), env);
    const body = await res.json() as { result: { tools: { inputSchema: { properties: Record<string, unknown> } }[] } };
    for (const tool of body.result.tools) {
      expect(Object.keys(tool.inputSchema.properties)).not.toContain('customer_id');
    }
  });
});
