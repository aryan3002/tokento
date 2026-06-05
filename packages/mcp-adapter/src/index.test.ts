import { describe, expect, it } from 'vitest';
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
