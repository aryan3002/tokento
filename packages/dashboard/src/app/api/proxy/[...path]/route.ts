// ============================================================
// Tokento Dashboard — server-side API proxy
// ============================================================
// The merchant API key is a full-scope credential. It previously reached the
// browser through NEXT_PUBLIC_TOKENTO_API_KEY (with a hardcoded fallback) and was
// even rendered in the UI with a copy button, so anyone who opened the dashboard —
// or read the JS bundle — held full merchant access.
//
// It now lives only in this server-side route. The browser talks to /api/proxy/*
// with no credential of its own; a merchant session JWT, when present, is still
// forwarded from the client since that is scoped to the signed-in merchant.

import { NextRequest } from 'next/server';

const API_BASE = process.env.TOKENTO_API_URL || 'http://localhost:4000';
const API_KEY = process.env.TOKENTO_API_KEY || '';

// Streaming responses (SSE) must not be buffered by the framework.
export const dynamic = 'force-dynamic';

async function handler(request: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  const search = request.nextUrl.search;
  const upstream = `${API_BASE}/${path.join('/')}${search}`;

  const headers = new Headers();
  headers.set('Content-Type', request.headers.get('Content-Type') || 'application/json');
  headers.set('Accept', request.headers.get('Accept') || '*/*');

  // Prefer the caller's merchant session; fall back to the server-held API key.
  const authorization = request.headers.get('Authorization');
  if (authorization) {
    headers.set('Authorization', authorization);
  } else if (API_KEY) {
    headers.set('X-API-Key', API_KEY);
  }

  const body = request.method === 'GET' || request.method === 'HEAD'
    ? undefined
    : await request.text();

  const response = await fetch(upstream, {
    method: request.method,
    headers,
    body,
    // Let SSE stream through rather than accumulating in memory.
    cache: 'no-store',
  });

  const responseHeaders = new Headers();
  const contentType = response.headers.get('Content-Type');
  if (contentType) responseHeaders.set('Content-Type', contentType);
  if (contentType?.includes('text/event-stream')) {
    responseHeaders.set('Cache-Control', 'no-cache, no-transform');
    responseHeaders.set('Connection', 'keep-alive');
  }

  return new Response(response.body, {
    status: response.status,
    headers: responseHeaders,
  });
}

// Named function exports: Next statically detects the HTTP methods a route supports,
// and re-exported consts are not reliably picked up.
export async function GET(request: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  return handler(request, ctx);
}
export async function POST(request: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  return handler(request, ctx);
}
export async function PUT(request: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  return handler(request, ctx);
}
export async function PATCH(request: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  return handler(request, ctx);
}
export async function DELETE(request: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  return handler(request, ctx);
}
