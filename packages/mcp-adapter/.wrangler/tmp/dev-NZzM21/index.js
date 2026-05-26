var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// .wrangler/tmp/bundle-4BYsu0/strip-cf-connecting-ip-header.js
function stripCfConnectingIPHeader(input, init) {
  const request = new Request(input, init);
  request.headers.delete("CF-Connecting-IP");
  return request;
}
__name(stripCfConnectingIPHeader, "stripCfConnectingIPHeader");
globalThis.fetch = new Proxy(globalThis.fetch, {
  apply(target, thisArg, argArray) {
    return Reflect.apply(target, thisArg, [
      stripCfConnectingIPHeader.apply(null, argArray)
    ]);
  }
});

// src/index.ts
var TOOLS = [
  {
    name: "query_loyalty_tokens",
    description: "Query available loyalty tokens for a customer. Returns all active, non-expired tokens that can be applied by an AI agent during checkout.",
    inputSchema: {
      type: "object",
      properties: {
        customer_id: { type: "string", description: "The customer UUID whose wallet to query." },
        merchant_id: { type: "string", description: "Optional: filter by specific merchant." },
        min_denomination: { type: "number", description: "Optional: minimum token value in USD." },
        category: { type: "string", description: "Optional: filter by product category." }
      },
      required: ["customer_id"]
    }
  },
  {
    name: "validate_token",
    description: "Validate whether a specific loyalty token can be applied to a transaction. Checks expiry, merchant match, transaction amount, and all conditions.",
    inputSchema: {
      type: "object",
      properties: {
        token_id: { type: "string", description: "The token UUID to validate." },
        merchant_id: { type: "string", description: "The merchant UUID for the transaction." },
        transaction_amount: { type: "number", description: "The transaction amount in USD." },
        channel: { type: "string", description: "Optional: the sales channel (e.g., online, in-store)." }
      },
      required: ["token_id", "merchant_id", "transaction_amount"]
    }
  },
  {
    name: "redeem_token",
    description: "Execute the redemption of a loyalty token, applying its value to the transaction. Returns the net transaction value after applying the token discount.",
    inputSchema: {
      type: "object",
      properties: {
        token_id: { type: "string", description: "The token UUID to redeem." },
        merchant_id: { type: "string", description: "The merchant UUID." },
        transaction_amount: { type: "number", description: "The transaction amount in USD." },
        idempotency_key: { type: "string", description: "Unique key to prevent duplicate redemptions." }
      },
      required: ["token_id", "merchant_id", "transaction_amount", "idempotency_key"]
    }
  }
];
var src_default = {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "POST",
          "Access-Control-Allow-Headers": "Content-Type, Authorization"
        }
      });
    }
    if (request.method !== "POST") {
      return jsonResponse({ error: "Method not allowed" }, 405);
    }
    try {
      const body = await request.json();
      switch (body.method) {
        case "initialize":
          return mcpResponse(body.id, {
            protocolVersion: "2024-11-05",
            capabilities: { tools: {} },
            serverInfo: { name: "tokento", version: "0.1.0" }
          });
        case "tools/list":
          return mcpResponse(body.id, { tools: TOOLS });
        case "tools/call":
          return handleToolCall(body, env);
        default:
          return mcpError(body.id, -32601, `Method not found: ${body.method}`);
      }
    } catch (err) {
      return mcpError(0, -32700, "Parse error");
    }
  }
};
async function handleToolCall(req, env) {
  const params = req.params;
  const { name, arguments: args } = params;
  const apiBase = env.API_BASE_URL;
  try {
    switch (name) {
      case "query_loyalty_tokens": {
        const customerId = args.customer_id;
        const queryParams = new URLSearchParams();
        if (args.merchant_id)
          queryParams.set("merchantId", args.merchant_id);
        if (args.min_denomination)
          queryParams.set("minDenomination", String(args.min_denomination));
        if (args.category)
          queryParams.set("category", args.category);
        const url = `${apiBase}/api/v1/wallet/${customerId}/tokens?${queryParams}`;
        const resp = await fetch(url, {
          headers: { "Authorization": `Bearer ${customerId}` }
        });
        const data = await resp.json();
        return mcpResponse(req.id, {
          content: [{ type: "text", text: JSON.stringify(data, null, 2) }]
        });
      }
      case "validate_token": {
        const url = `${apiBase}/api/v1/tokens/${args.token_id}/validate`;
        const resp = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer agent-token`
          },
          body: JSON.stringify({
            transactionAmount: args.transaction_amount,
            merchantId: args.merchant_id,
            channel: args.channel,
            agentId: "mcp-adapter"
          })
        });
        const data = await resp.json();
        return mcpResponse(req.id, {
          content: [{ type: "text", text: JSON.stringify(data, null, 2) }]
        });
      }
      case "redeem_token": {
        const url = `${apiBase}/api/v1/tokens/${args.token_id}/redeem`;
        const resp = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer agent-token`
          },
          body: JSON.stringify({
            transactionAmount: args.transaction_amount,
            merchantId: args.merchant_id,
            agentId: "mcp-adapter",
            idempotencyKey: args.idempotency_key
          })
        });
        const data = await resp.json();
        return mcpResponse(req.id, {
          content: [{ type: "text", text: JSON.stringify(data, null, 2) }]
        });
      }
      default:
        return mcpError(req.id, -32602, `Unknown tool: ${name}`);
    }
  } catch (err) {
    return mcpError(req.id, -32603, `Tool execution failed: ${err.message}`);
  }
}
__name(handleToolCall, "handleToolCall");
function mcpResponse(id, result) {
  return jsonResponse({ jsonrpc: "2.0", id, result });
}
__name(mcpResponse, "mcpResponse");
function mcpError(id, code, message) {
  return jsonResponse({ jsonrpc: "2.0", id, error: { code, message } });
}
__name(mcpError, "mcpError");
function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*"
    }
  });
}
__name(jsonResponse, "jsonResponse");

// ../../node_modules/.pnpm/wrangler@3.114.17_@cloudflare+workers-types@4.20260522.1/node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;

// ../../node_modules/.pnpm/wrangler@3.114.17_@cloudflare+workers-types@4.20260522.1/node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
function reduceError(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError(e.cause)
  };
}
__name(reduceError, "reduceError");
var jsonError = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } catch (e) {
    const error = reduceError(e);
    return Response.json(error, {
      status: 500,
      headers: { "MF-Experimental-Error-Stack": "true" }
    });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError;

// .wrangler/tmp/bundle-4BYsu0/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = src_default;

// ../../node_modules/.pnpm/wrangler@3.114.17_@cloudflare+workers-types@4.20260522.1/node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");

// .wrangler/tmp/bundle-4BYsu0/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof __Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
__name(__Facade_ScheduledController__, "__Facade_ScheduledController__");
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = (request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    };
    #dispatcher = (type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    };
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;
export {
  __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default as default
};
//# sourceMappingURL=index.js.map
