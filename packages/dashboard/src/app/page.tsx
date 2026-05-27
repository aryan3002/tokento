"use client";
import { useState, useEffect, useRef, useCallback, useMemo, FormEvent } from "react";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
const API_KEY =
  process.env.NEXT_PUBLIC_TOKENTO_API_KEY ||
  "tk_dev_local_sandbox_key_do_not_use_in_production_0000000000000000";
const B2B_SESSION_STORAGE_KEY = "tokento_b2b_session_jwt";
const B2B_SESSION_CLEARED_EVENT = "tokento:b2b-session-cleared";

function getB2BSessionJwt(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(B2B_SESSION_STORAGE_KEY);
}

function setB2BSessionJwt(value: string | null): void {
  if (typeof window === "undefined") return;
  if (!value) {
    window.localStorage.removeItem(B2B_SESSION_STORAGE_KEY);
    return;
  }
  window.localStorage.setItem(B2B_SESSION_STORAGE_KEY, value);
}

type Token = {
  id: string;
  merchantId: string;
  customerId: string;
  earnRuleId: string;
  denomination: number;
  tokenType: string;
  status: "ACTIVE" | "REDEEMED" | "EXPIRED" | "REJECTED";
  agentPresentableFlag: boolean;
  stackabilityFlag: boolean;
  expiryAt: string;
  redeemedAt: string | null;
  createdAt: string;
  isSandbox: boolean;
};

type EarnRule = {
  id: string;
  merchantId: string;
  name: string;
  spendThreshold: number;
  tokenDenomination: number;
  expiryDays: number;
  agentPresentableFlag: boolean;
  isActive: boolean;
};

type Redemption = {
  id: string;
  tokenId: string;
  merchantId: string;
  customerId: string;
  transactionAmount: number;
  tokenDenomination: number;
  netValue: number;
  agentId: string | null;
  settlementRef: string;
  redeemedAt: string;
};

type Merchant = {
  id: string;
  name: string;
  email: string;
  agentOptIn: boolean;
  settlementType: string;
  settlementTiming: string;
  webhookUrl: string | null;
  isSandbox: boolean;
};

type WebhookEndpoint = {
  id: string;
  merchantId: string;
  url: string;
  events: string[];
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

type WebhookDelivery = {
  id: string;
  webhookEndpointId: string;
  endpointUrl: string;
  eventType: string;
  responseCode: number | null;
  responseBody: string | null;
  attempts: number;
  retryCount: number;
  nextRetryAt: string | null;
  deliveredAt: string | null;
  createdAt: string;
};

type Tab = "overview" | "tokens" | "rules" | "redemptions" | "webhooks" | "settings" | "demo" | "status";

type ConnectionState = "connecting" | "live" | "down";

const TAB_DEFS: { key: Tab; label: string; icon: string }[] = [
  { key: "overview", label: "Overview", icon: "📊" },
  { key: "tokens", label: "Tokens", icon: "🎫" },
  { key: "rules", label: "Earn Rules", icon: "⚙️" },
  { key: "redemptions", label: "Redemptions", icon: "💰" },
  { key: "webhooks", label: "Webhooks", icon: "🔔" },
  { key: "settings", label: "Settings", icon: "🔑" },
  { key: "demo", label: "Demo Wiring", icon: "🤖" },
  { key: "status", label: "System Status", icon: "🟢" },
];

const SERVICES = [
  { name: "API Server", url: `${API_BASE}/health`, port: 4000 },
  { name: "MCP Adapter", url: "http://localhost:8787", port: 8787 },
  { name: "PostgreSQL", url: null, port: 5433 },
  { name: "Redis", url: null, port: 6379 },
];

function buildAuthHeaders(init: RequestInit, sessionJwt: string | null): Headers {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");
  if (sessionJwt) {
    headers.set("Authorization", `Bearer ${sessionJwt}`);
    headers.delete("X-API-Key");
  } else {
    headers.set("X-API-Key", API_KEY);
    headers.delete("Authorization");
  }
  return headers;
}

function isB2BAuthFailure(status: number, body: string): boolean {
  return (
    status === 401 ||
    status === 403 ||
    body.includes('"auth_error"') ||
    body.includes("stytch_") ||
    body.includes("dev_session_disabled")
  );
}

async function fetchWithAuth(path: string, init: RequestInit, sessionJwt: string | null): Promise<Response> {
  return fetch(`${API_BASE}${path}`, {
    ...init,
    headers: buildAuthHeaders(init, sessionJwt),
  });
}

async function api<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const sessionJwt = getB2BSessionJwt();
  let res = await fetchWithAuth(path, init, sessionJwt);
  let body = "";

  if (!res.ok) {
    body = await res.text().catch(() => "");

    if (sessionJwt && isB2BAuthFailure(res.status, body)) {
      setB2BSessionJwt(null);
      window.dispatchEvent(new CustomEvent(B2B_SESSION_CLEARED_EVENT));
      res = await fetchWithAuth(path, init, null);
      body = res.ok ? "" : await res.text().catch(() => "");
    }
  }

  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText}: ${body || path}`);
  }

  if (res.status === 204) return undefined as T;
  return res.json();
}

export default function Dashboard() {
  const [tab, setTab] = useState<Tab>("overview");
  const [apiKeyVisible, setApiKeyVisible] = useState(false);
  const [b2bSessionJwt, setB2BSessionJwtState] = useState<string | null>(() => getB2BSessionJwt());
  const [sessionInput, setSessionInput] = useState("");
  const [authWarning, setAuthWarning] = useState<string | null>(null);
  const [serviceStatus, setServiceStatus] = useState<Record<string, "checking" | "up" | "down">>({});
  const [connection, setConnection] = useState<ConnectionState>("connecting");
  const [lastEventAt, setLastEventAt] = useState<string | null>(null);
  const [flashTokenId, setFlashTokenId] = useState<string | null>(null);

  const [merchant, setMerchant] = useState<Merchant | null>(null);
  const [tokens, setTokens] = useState<Token[]>([]);
  const [earnRules, setEarnRules] = useState<EarnRule[]>([]);
  const [redemptions, setRedemptions] = useState<Redemption[]>([]);
  const [webhookEndpoints, setWebhookEndpoints] = useState<WebhookEndpoint[]>([]);
  const [webhookDeliveries, setWebhookDeliveries] = useState<WebhookDelivery[]>([]);

  const updateSessionJwt = useCallback((next: string | null) => {
    setB2BSessionJwt(next);
    setB2BSessionJwtState(next);
  }, []);

  useEffect(() => {
    const handleSessionCleared = () => {
      setB2BSessionJwtState(null);
      setSessionInput("");
      setAuthWarning("Stored B2B session was rejected. Dashboard retried with the local API key.");
    };

    window.addEventListener(B2B_SESSION_CLEARED_EVENT, handleSessionCleared);
    return () => window.removeEventListener(B2B_SESSION_CLEARED_EVENT, handleSessionCleared);
  }, []);

  useEffect(() => {
    if (b2bSessionJwt) {
      return;
    }

    fetch(`${API_BASE}/api/v1/auth/b2b/dev-session`)
      .then(async (res) => {
        if (!res.ok) return null;
        const body = await res.json();
        return typeof body?.sessionJwt === "string" ? body.sessionJwt : null;
      })
      .then((sessionJwt) => {
        if (sessionJwt) {
          updateSessionJwt(sessionJwt);
          setAuthWarning("Using dev fallback B2B session. Real Stytch keys are required before merge.");
        }
      })
      .catch(() => {
        setAuthWarning("No B2B session found. Paste a Stytch B2B session JWT in Settings.");
      });
  }, [b2bSessionJwt, updateSessionJwt]);

  const refreshWebhookData = useCallback(async () => {
    try {
      const [endpoints, deliveries] = await Promise.all([
        api<WebhookEndpoint[]>("/api/v1/merchants/me/webhooks"),
        api<WebhookDelivery[]>("/api/v1/merchants/me/webhooks/deliveries?limit=20"),
      ]);
      setWebhookEndpoints(Array.isArray(endpoints) ? endpoints : []);
      setWebhookDeliveries(Array.isArray(deliveries) ? deliveries : []);
    } catch {
      // ignore transient webhook-refresh errors
    }
  }, []);

  const refreshAll = useCallback(async () => {
    try {
      const [m, t, r, rd, endpoints, deliveries] = await Promise.all([
        api<Merchant>("/api/v1/merchants/me"),
        api<Token[]>("/api/v1/merchants/me/tokens"),
        api<EarnRule[]>("/api/v1/merchants/me/earn-rules"),
        api<Redemption[]>("/api/v1/merchants/me/redemptions"),
        api<WebhookEndpoint[]>("/api/v1/merchants/me/webhooks"),
        api<WebhookDelivery[]>("/api/v1/merchants/me/webhooks/deliveries?limit=20"),
      ]);
      setMerchant(m);
      setTokens(Array.isArray(t) ? t : []);
      setEarnRules(Array.isArray(r) ? r : []);
      setRedemptions(Array.isArray(rd) ? rd : []);
      setWebhookEndpoints(Array.isArray(endpoints) ? endpoints : []);
      setWebhookDeliveries(Array.isArray(deliveries) ? deliveries : []);
    } catch (err) {
      console.error("Initial fetch failed", err);
    }
  }, []);

  // Initial fetch
  useEffect(() => {
    void Promise.resolve().then(() => {
      refreshAll();
    });
  }, [refreshAll]);

  // SSE subscription — replaces 3s polling
  const esRef = useRef<EventSource | null>(null);
  useEffect(() => {
    let cancelled = false;

    const connect = () => {
      if (cancelled) return;
      setConnection("connecting");
      const authQuery = b2bSessionJwt
        ? `sessionJwt=${encodeURIComponent(b2bSessionJwt)}`
        : `apiKey=${encodeURIComponent(API_KEY)}`;
      const url = `${API_BASE}/api/v1/events/stream?${authQuery}`;
      const es = new EventSource(url);
      esRef.current = es;

      es.addEventListener("ready", () => {
        setConnection("live");
      });

      es.addEventListener("token.minted", (e) => {
        const payload = JSON.parse((e as MessageEvent).data);
        setLastEventAt(new Date().toISOString());
        // We don't have the full token row in the event payload; refetch tokens.
        api<Token[]>("/api/v1/merchants/me/tokens").then((next) => {
          if (Array.isArray(next)) setTokens(next);
        }).catch(() => {});
        refreshWebhookData();
        flashRow(payload.tokenId);
      });

      es.addEventListener("token.redeemed", (e) => {
        const payload = JSON.parse((e as MessageEvent).data);
        setLastEventAt(new Date().toISOString());
        setTokens((prev) =>
          prev.map((tk) =>
            tk.id === payload.tokenId
              ? { ...tk, status: "REDEEMED", redeemedAt: new Date().toISOString() }
              : tk,
          ),
        );
        setRedemptions((prev) => [
          {
            id: payload.redemptionId,
            tokenId: payload.tokenId,
            merchantId: payload.merchantId,
            customerId: payload.customerId,
            transactionAmount: payload.transactionAmount,
            tokenDenomination: payload.denomination,
            netValue: payload.netValue,
            agentId: payload.agentId ?? null,
            settlementRef: payload.settlementRef,
            redeemedAt: new Date().toISOString(),
          },
          ...prev,
        ]);
        refreshWebhookData();
        flashRow(payload.tokenId);
      });

      es.addEventListener("earn_rule.created", () => {
        setLastEventAt(new Date().toISOString());
        api<EarnRule[]>("/api/v1/merchants/me/earn-rules").then((next) => {
          if (Array.isArray(next)) setEarnRules(next);
        }).catch(() => {});
      });
      es.addEventListener("earn_rule.updated", () => {
        setLastEventAt(new Date().toISOString());
        api<EarnRule[]>("/api/v1/merchants/me/earn-rules").then((next) => {
          if (Array.isArray(next)) setEarnRules(next);
        }).catch(() => {});
      });

      es.onerror = () => {
        setConnection("down");
        es.close();
        if (!cancelled) setTimeout(connect, 2000);
      };
    };

    const flashRow = (tokenId: string) => {
      setFlashTokenId(tokenId);
      setTimeout(() => setFlashTokenId((cur) => (cur === tokenId ? null : cur)), 1500);
    };

    connect();
    return () => {
      cancelled = true;
      esRef.current?.close();
    };
  }, [b2bSessionJwt, refreshWebhookData]);

  const checkServices = async () => {
    for (const svc of SERVICES) {
      setServiceStatus((s) => ({ ...s, [svc.name]: "checking" }));
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 2500);
        if (svc.url) {
          await fetch(svc.url, { signal: ctrl.signal });
        } else {
          await fetch(`http://localhost:${svc.port}`, { signal: ctrl.signal, mode: "no-cors" });
        }
        clearTimeout(t);
        setServiceStatus((s) => ({ ...s, [svc.name]: "up" }));
      } catch {
        setServiceStatus((s) => ({ ...s, [svc.name]: "down" }));
      }
    }
  };

  const earnRuleNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of earnRules) map.set(r.id, r.name);
    return map;
  }, [earnRules]);

  const stats = useMemo(() => ({
    tokensIssued: tokens.length,
    activeTokens: tokens.filter((t) => t.status === "ACTIVE").length,
    redemptions: redemptions.length,
    totalValue: tokens.reduce((sum, t) => sum + t.denomination, 0),
  }), [tokens, redemptions]);

  return (
    <div className="flex min-h-screen">
      <aside className="w-64 border-r border-border bg-surface-1 flex flex-col shrink-0">
        <div className="p-6 border-b border-border">
          <h1 className="text-xl font-bold gradient-text">◆ Tokento</h1>
          <p className="text-xs text-text-muted mt-1">Merchant Dashboard</p>
        </div>
        <nav className="flex-1 p-3 space-y-1">
          {TAB_DEFS.map((t) => (
            <button
              key={t.key}
              onClick={() => {
                setTab(t.key);
                if (t.key === "status") checkServices();
              }}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150 ${
                tab === t.key
                  ? "bg-brand-500/10 text-brand-400"
                  : "text-text-secondary hover:text-text-primary hover:bg-surface-2"
              }`}
            >
              <span>{t.icon}</span>
              {t.label}
            </button>
          ))}
        </nav>
        <div className="p-4 border-t border-border space-y-3">
          <ConnectionPill state={connection} lastEventAt={lastEventAt} />
          <div className="glass rounded-lg p-3">
            <p className="text-xs text-text-muted">Merchant</p>
            <p className="text-sm font-semibold truncate">{merchant?.name || "Loading..."}</p>
            <p className="text-xs text-text-muted truncate">{merchant?.email || "—"}</p>
          </div>
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto">
        <header className="sticky top-0 z-10 glass border-b border-border px-8 py-4 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">
              {TAB_DEFS.find((t) => t.key === tab)?.icon} {TAB_DEFS.find((t) => t.key === tab)?.label}
            </h2>
            <p className="text-xs text-text-muted">Sandbox environment · Live via SSE</p>
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-warning/10 text-warning">
              <span className="w-1.5 h-1.5 rounded-full bg-warning pulse-dot" />
              Sandbox
            </span>
          </div>
        </header>

        <div className="p-8">
          {tab === "overview" && (
            <OverviewTab
              stats={stats}
              recentTokens={tokens.slice(0, 5)}
              recentRedemptions={redemptions.slice(0, 5)}
              earnRuleNameById={earnRuleNameById}
              flashTokenId={flashTokenId}
            />
          )}
          {tab === "tokens" && (
            <TokensTab tokens={tokens} earnRuleNameById={earnRuleNameById} flashTokenId={flashTokenId} />
          )}
          {tab === "rules" && <EarnRulesTab rules={earnRules} onCreated={refreshAll} />}
          {tab === "redemptions" && <RedemptionsTab redemptions={redemptions} />}
          {tab === "webhooks" && (
            <WebhooksTab
              endpoints={webhookEndpoints}
              deliveries={webhookDeliveries}
              onChanged={refreshWebhookData}
            />
          )}
          {tab === "settings" && merchant && (
            <SettingsTab
              key={merchant.id}
              apiKey={API_KEY}
              visible={apiKeyVisible}
              onToggle={() => setApiKeyVisible(!apiKeyVisible)}
              merchant={merchant}
              b2bSessionJwt={b2bSessionJwt}
              sessionInput={sessionInput}
              setSessionInput={setSessionInput}
              authWarning={authWarning}
              onSessionSave={() => {
                const trimmed = sessionInput.trim();
                if (!trimmed) return;
                updateSessionJwt(trimmed);
                setSessionInput("");
                setAuthWarning(null);
                refreshAll();
              }}
              onSessionClear={() => {
                updateSessionJwt(null);
                setAuthWarning("B2B session cleared. Dashboard will fall back to API key auth.");
                refreshAll();
              }}
              onSaved={refreshAll}
            />
          )}
          {tab === "demo" && <DemoTab merchant={merchant} />}
          {tab === "status" && (
            <StatusTab services={SERVICES} status={serviceStatus} onCheck={checkServices} connection={connection} />
          )}
        </div>
      </main>
    </div>
  );
}

/* ---- Connection pill ---- */
function ConnectionPill({ state, lastEventAt }: { state: ConnectionState; lastEventAt: string | null }) {
  const cfg = {
    connecting: { dot: "bg-warning", text: "text-warning", label: "Connecting…" },
    live: { dot: "bg-success", text: "text-success", label: "Live" },
    down: { dot: "bg-error", text: "text-error", label: "Reconnecting…" },
  }[state];
  return (
    <div className="glass rounded-lg p-3">
      <div className="flex items-center gap-2">
        <span className={`w-2 h-2 rounded-full ${cfg.dot} ${state === "live" ? "pulse-dot" : ""}`} />
        <span className={`text-xs font-medium ${cfg.text}`}>{cfg.label}</span>
      </div>
      {lastEventAt && (
        <p className="text-[10px] text-text-muted mt-1">Last event: {new Date(lastEventAt).toLocaleTimeString()}</p>
      )}
    </div>
  );
}

/* ---- Stat Card ---- */
function StatCard({ label, value, icon }: { label: string; value: string | number; icon: string }) {
  return (
    <div className="glass rounded-xl p-5 hover:border-border-hover transition-colors">
      <div className="flex items-center justify-between mb-3">
        <span className="text-2xl">{icon}</span>
      </div>
      <p className="text-2xl font-bold">{value}</p>
      <p className="text-xs text-text-muted mt-1">{label}</p>
    </div>
  );
}

/* ---- Overview ---- */
function OverviewTab({
  stats,
  recentTokens,
  recentRedemptions,
  earnRuleNameById,
  flashTokenId,
}: {
  stats: { tokensIssued: number; activeTokens: number; redemptions: number; totalValue: number };
  recentTokens: Token[];
  recentRedemptions: Redemption[];
  earnRuleNameById: Map<string, string>;
  flashTokenId: string | null;
}) {
  return (
    <div className="space-y-8 stagger-children">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon="🎫" label="Tokens Issued" value={stats.tokensIssued} />
        <StatCard icon="✅" label="Active Tokens" value={stats.activeTokens} />
        <StatCard icon="💰" label="Redemptions" value={stats.redemptions} />
        <StatCard icon="💵" label="Total Value" value={`$${stats.totalValue}`} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="glass rounded-xl p-5">
          <h3 className="font-semibold mb-4">Recent Tokens</h3>
          <div className="space-y-3">
            {recentTokens.length === 0 && <p className="text-sm text-text-muted">No tokens yet. Run <code className="bg-surface-3 px-1 rounded">pnpm db:seed</code> to populate.</p>}
            {recentTokens.map((t) => (
              <div
                key={t.id}
                className={`flex items-center justify-between py-2 border-b border-border last:border-0 transition-colors ${
                  flashTokenId === t.id ? "bg-brand-500/10" : ""
                }`}
              >
                <div>
                  <p className="text-sm font-medium font-mono">{t.id.slice(0, 8)}…</p>
                  <p className="text-xs text-text-muted">{earnRuleNameById.get(t.earnRuleId) || t.earnRuleId.slice(0, 8)}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-semibold">${t.denomination}</p>
                  <StatusBadge status={t.status} />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="glass rounded-xl p-5">
          <h3 className="font-semibold mb-4">Recent Redemptions</h3>
          <div className="space-y-3">
            {recentRedemptions.length === 0 && <p className="text-sm text-text-muted">No redemptions yet. Ask Claude to redeem a token to see this update live.</p>}
            {recentRedemptions.map((r) => (
              <div key={r.id} className="flex items-center justify-between py-2 border-b border-border last:border-0">
                <div>
                  <p className="text-sm font-medium">{r.agentId || "MCP Adapter"}</p>
                  <p className="text-xs text-text-muted">{new Date(r.redeemedAt).toLocaleString()}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-semibold text-success">-${r.tokenDenomination}</p>
                  <p className="text-xs text-text-muted">Net: ${r.netValue}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="glass rounded-xl p-6 glow">
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 rounded-xl bg-brand-500/20 flex items-center justify-center text-2xl shrink-0">🤖</div>
          <div>
            <h3 className="font-semibold text-lg">MCP Agent Integration Active</h3>
            <p className="text-sm text-text-secondary mt-1">
              AI agents can discover and use your loyalty tokens via the Token Query Interface. 3 tools available:{" "}
              <code className="text-xs bg-surface-3 px-1.5 py-0.5 rounded font-mono">query_loyalty_tokens</code>,{" "}
              <code className="text-xs bg-surface-3 px-1.5 py-0.5 rounded font-mono">validate_token</code>,{" "}
              <code className="text-xs bg-surface-3 px-1.5 py-0.5 rounded font-mono">redeem_token</code>
            </p>
            <div className="flex items-center gap-2 mt-3">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-success/10 text-success">
                <span className="w-1.5 h-1.5 rounded-full bg-success pulse-dot" />
                MCP Server Live
              </span>
              <span className="text-xs text-text-muted">localhost:8787</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---- Tokens ---- */
function TokensTab({
  tokens,
  earnRuleNameById,
  flashTokenId,
}: {
  tokens: Token[];
  earnRuleNameById: Map<string, string>;
  flashTokenId: string | null;
}) {
  return (
    <div className="glass rounded-xl overflow-hidden animate-slide-up">
      <div className="p-5 border-b border-border flex items-center justify-between">
        <h3 className="font-semibold">All Tokens</h3>
        <span className="text-xs text-text-muted">{tokens.length} total</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-text-muted text-xs uppercase tracking-wider">
              <th className="text-left p-4">Token ID</th>
              <th className="text-left p-4">Customer</th>
              <th className="text-left p-4">Earn Rule</th>
              <th className="text-right p-4">Value</th>
              <th className="text-left p-4">Status</th>
              <th className="text-left p-4">Expires</th>
            </tr>
          </thead>
          <tbody>
            {tokens.map((t) => (
              <tr
                key={t.id}
                className={`border-b border-border/50 hover:bg-surface-2/50 transition-colors ${
                  flashTokenId === t.id ? "bg-brand-500/10" : ""
                }`}
              >
                <td className="p-4 font-mono text-xs">{t.id.slice(0, 12)}…</td>
                <td className="p-4 text-text-secondary font-mono text-xs">{t.customerId.slice(0, 12)}…</td>
                <td className="p-4">{earnRuleNameById.get(t.earnRuleId) || t.earnRuleId.slice(0, 8)}</td>
                <td className="p-4 text-right font-semibold">${t.denomination}</td>
                <td className="p-4"><StatusBadge status={t.status} /></td>
                <td className="p-4 text-text-muted text-xs">{new Date(t.expiryAt).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ---- Earn Rules ---- */
function EarnRulesTab({ rules, onCreated }: { rules: EarnRule[]; onCreated: () => void }) {
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: "",
    spendThreshold: 25,
    tokenDenomination: 5,
    expiryDays: 90,
  });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await api("/api/v1/merchants/me/earn-rules", {
        method: "POST",
        body: JSON.stringify(form),
      });
      setShowForm(false);
      setForm({ name: "", spendThreshold: 25, tokenDenomination: 5, expiryDays: 90 });
      onCreated();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-4 stagger-children">
      {rules.map((r) => (
        <div key={r.id} className="glass rounded-xl p-5 hover:border-border-hover transition-colors">
          <div className="flex items-center justify-between">
            <div>
              <h4 className="font-semibold">{r.name}</h4>
              <p className="text-sm text-text-secondary mt-1">
                Spend ≥ ${r.spendThreshold} → earn ${r.tokenDenomination} token · Expires in {r.expiryDays} days
              </p>
            </div>
            <div className="flex items-center gap-3">
              {r.agentPresentableFlag && (
                <span className="text-xs bg-brand-500/10 text-brand-400 px-2.5 py-1 rounded-full">🤖 Agent Visible</span>
              )}
              <StatusBadge status={r.isActive ? "ACTIVE" : "INACTIVE"} />
            </div>
          </div>
        </div>
      ))}

      {showForm ? (
        <form onSubmit={submit} className="glass rounded-xl p-5 space-y-4">
          <h4 className="font-semibold">New Earn Rule</h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="text-sm space-y-1">
              <span className="text-text-secondary">Name</span>
              <input required className="w-full bg-surface-3 border border-border rounded-lg px-3 py-2 text-sm" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Spend $25, get $5 off" />
            </label>
            <label className="text-sm space-y-1">
              <span className="text-text-secondary">Spend threshold ($)</span>
              <input required type="number" min={0} className="w-full bg-surface-3 border border-border rounded-lg px-3 py-2 text-sm" value={form.spendThreshold} onChange={(e) => setForm({ ...form, spendThreshold: Number(e.target.value) })} />
            </label>
            <label className="text-sm space-y-1">
              <span className="text-text-secondary">Token denomination ($)</span>
              <input required type="number" min={1} className="w-full bg-surface-3 border border-border rounded-lg px-3 py-2 text-sm" value={form.tokenDenomination} onChange={(e) => setForm({ ...form, tokenDenomination: Number(e.target.value) })} />
            </label>
            <label className="text-sm space-y-1">
              <span className="text-text-secondary">Expiry (days)</span>
              <input required type="number" min={1} className="w-full bg-surface-3 border border-border rounded-lg px-3 py-2 text-sm" value={form.expiryDays} onChange={(e) => setForm({ ...form, expiryDays: Number(e.target.value) })} />
            </label>
          </div>
          {error && <p className="text-xs text-error">{error}</p>}
          <div className="flex items-center gap-2">
            <button type="submit" disabled={submitting} className="px-4 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium transition-colors disabled:opacity-60">
              {submitting ? "Creating…" : "Create"}
            </button>
            <button type="button" onClick={() => setShowForm(false)} className="px-4 py-2 rounded-lg bg-surface-3 hover:bg-surface-4 text-sm font-medium transition-colors">
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <button onClick={() => setShowForm(true)} className="w-full border-2 border-dashed border-border hover:border-brand-500/50 rounded-xl p-6 text-text-muted hover:text-brand-400 transition-colors text-sm font-medium">
          + Create Earn Rule
        </button>
      )}
    </div>
  );
}

/* ---- Redemptions ---- */
function RedemptionsTab({ redemptions }: { redemptions: Redemption[] }) {
  return (
    <div className="glass rounded-xl overflow-hidden animate-slide-up">
      <div className="p-5 border-b border-border flex items-center justify-between">
        <h3 className="font-semibold">Redemption Log</h3>
        <span className="text-xs text-text-muted">{redemptions.length} total</span>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-text-muted text-xs uppercase tracking-wider">
            <th className="text-left p-4">ID</th>
            <th className="text-left p-4">Token</th>
            <th className="text-right p-4">Amount</th>
            <th className="text-right p-4">Discount</th>
            <th className="text-right p-4">Net</th>
            <th className="text-left p-4">Agent</th>
            <th className="text-left p-4">Date</th>
          </tr>
        </thead>
        <tbody>
          {redemptions.length === 0 && (
            <tr>
              <td colSpan={7} className="p-6 text-center text-sm text-text-muted">
                No redemptions yet. Ask Claude to redeem a token to see this update live.
              </td>
            </tr>
          )}
          {redemptions.map((r) => (
            <tr key={r.id} className="border-b border-border/50 hover:bg-surface-2/50 transition-colors">
              <td className="p-4 font-mono text-xs">{r.id.slice(0, 8)}…</td>
              <td className="p-4 font-mono text-xs">{r.tokenId.slice(0, 8)}…</td>
              <td className="p-4 text-right">${r.transactionAmount}</td>
              <td className="p-4 text-right text-success font-semibold">-${r.tokenDenomination}</td>
              <td className="p-4 text-right font-semibold">${r.netValue}</td>
              <td className="p-4">
                <span className="text-xs bg-brand-500/10 text-brand-400 px-2 py-0.5 rounded-full">{r.agentId || "MCP Adapter"}</span>
              </td>
              <td className="p-4 text-text-muted text-xs">{new Date(r.redeemedAt).toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ---- Webhooks ---- */
function WebhooksTab({
  endpoints,
  deliveries,
  onChanged,
}: {
  endpoints: WebhookEndpoint[];
  deliveries: WebhookDelivery[];
  onChanged: () => void;
}) {
  const [url, setUrl] = useState("");
  const [eventMinted, setEventMinted] = useState(true);
  const [eventRedeemed, setEventRedeemed] = useState(true);
  const [eventExpired, setEventExpired] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const createEndpoint = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    const events = [
      eventMinted ? "token.minted" : null,
      eventRedeemed ? "token.redeemed" : null,
      eventExpired ? "token.expired" : null,
    ].filter((value): value is string => Boolean(value));

    if (events.length === 0) {
      setError("Select at least one event type.");
      setSubmitting(false);
      return;
    }

    try {
      await api("/api/v1/merchants/me/webhooks", {
        method: "POST",
        body: JSON.stringify({ url, events }),
      });
      setUrl("");
      setEventMinted(true);
      setEventRedeemed(true);
      setEventExpired(false);
      onChanged();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const deleteEndpoint = async (endpointId: string) => {
    setDeletingId(endpointId);
    try {
      await api(`/api/v1/merchants/me/webhooks/${endpointId}`, { method: "DELETE" });
      onChanged();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="space-y-6 max-w-5xl">
      <form onSubmit={createEndpoint} className="glass rounded-xl p-5 space-y-4">
        <h3 className="font-semibold">Create Webhook Endpoint</h3>
        <div className="space-y-2">
          <label className="text-sm text-text-secondary">Endpoint URL</label>
          <input
            required
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://webhook.site/your-id"
            className="w-full bg-surface-3 border border-border rounded-lg px-4 py-3 text-sm placeholder:text-text-muted focus:outline-none focus:border-brand-500 transition-colors"
          />
        </div>
        <div>
          <p className="text-sm text-text-secondary mb-2">Event types</p>
          <div className="flex flex-wrap gap-3 text-sm">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={eventMinted} onChange={(e) => setEventMinted(e.target.checked)} />
              <span>token.minted</span>
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={eventRedeemed} onChange={(e) => setEventRedeemed(e.target.checked)} />
              <span>token.redeemed</span>
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={eventExpired} onChange={(e) => setEventExpired(e.target.checked)} />
              <span>token.expired</span>
            </label>
          </div>
        </div>
        {error && <p className="text-xs text-error">{error}</p>}
        <button
          type="submit"
          disabled={submitting}
          className="px-4 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium transition-colors disabled:opacity-60"
        >
          {submitting ? "Creating…" : "Create endpoint"}
        </button>
      </form>

      <div className="glass rounded-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold">Configured Endpoints</h3>
          <span className="text-xs text-text-muted">{endpoints.length} total</span>
        </div>
        {endpoints.length === 0 ? (
          <p className="text-sm text-text-muted">No webhook endpoints configured yet.</p>
        ) : (
          <div className="space-y-3">
            {endpoints.map((endpoint) => (
              <div key={endpoint.id} className="border border-border rounded-lg p-4 flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-sm font-medium break-all">{endpoint.url}</p>
                  <div className="flex flex-wrap gap-1 mt-2">
                    {endpoint.events.map((eventType) => (
                      <span key={eventType} className="text-xs bg-surface-3 px-2 py-0.5 rounded-full">
                        {eventType}
                      </span>
                    ))}
                  </div>
                  <p className="text-xs text-text-muted mt-2">
                    Created {new Date(endpoint.createdAt).toLocaleString()}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => deleteEndpoint(endpoint.id)}
                  disabled={deletingId === endpoint.id}
                  className="px-3 py-1.5 rounded-lg bg-error/15 hover:bg-error/25 text-error text-xs font-medium transition-colors disabled:opacity-60 shrink-0"
                >
                  {deletingId === endpoint.id ? "Deleting…" : "Delete"}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="glass rounded-xl overflow-hidden">
        <div className="p-5 border-b border-border flex items-center justify-between">
          <h3 className="font-semibold">Recent Deliveries</h3>
          <span className="text-xs text-text-muted">{deliveries.length} shown</span>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-text-muted text-xs uppercase tracking-wider">
              <th className="text-left p-4">Event</th>
              <th className="text-left p-4">Endpoint</th>
              <th className="text-left p-4">Attempts</th>
              <th className="text-left p-4">Retry Count</th>
              <th className="text-left p-4">Status</th>
              <th className="text-left p-4">Last Attempt</th>
            </tr>
          </thead>
          <tbody>
            {deliveries.length === 0 && (
              <tr>
                <td colSpan={6} className="p-6 text-center text-sm text-text-muted">
                  No delivery attempts yet. Trigger mint/redeem to see webhook deliveries.
                </td>
              </tr>
            )}
            {deliveries.map((delivery) => (
              <tr key={delivery.id} className="border-b border-border/50 hover:bg-surface-2/50 transition-colors">
                <td className="p-4 text-xs">{delivery.eventType}</td>
                <td className="p-4 text-xs font-mono max-w-[280px] truncate" title={delivery.endpointUrl}>{delivery.endpointUrl}</td>
                <td className="p-4 text-xs">{delivery.attempts}</td>
                <td className="p-4 text-xs">{delivery.retryCount}</td>
                <td className="p-4 text-xs">
                  {delivery.deliveredAt ? (
                    <span className="text-success">Delivered ({delivery.responseCode ?? "-"})</span>
                  ) : delivery.nextRetryAt ? (
                    <span className="text-warning">Retrying ({delivery.responseCode ?? "-"})</span>
                  ) : (
                    <span className="text-error">Failed ({delivery.responseCode ?? "-"})</span>
                  )}
                </td>
                <td className="p-4 text-xs text-text-muted">{new Date(delivery.createdAt).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ---- Settings ---- */
function SettingsTab({
  apiKey,
  visible,
  onToggle,
  merchant,
  b2bSessionJwt,
  sessionInput,
  setSessionInput,
  authWarning,
  onSessionSave,
  onSessionClear,
  onSaved,
}: {
  apiKey: string;
  visible: boolean;
  onToggle: () => void;
  merchant: Merchant;
  b2bSessionJwt: string | null;
  sessionInput: string;
  setSessionInput: (value: string) => void;
  authWarning: string | null;
  onSessionSave: () => void;
  onSessionClear: () => void;
  onSaved: () => void;
}) {
  const [agentOptIn, setAgentOptIn] = useState(merchant.agentOptIn);
  const [webhookUrl, setWebhookUrl] = useState(merchant.webhookUrl || "");
  const [savingToggle, setSavingToggle] = useState(false);
  const [savingWebhook, setSavingWebhook] = useState(false);
  const [webhookError, setWebhookError] = useState<string | null>(null);

  const flipToggle = async () => {
    const next = !agentOptIn;
    setAgentOptIn(next);
    setSavingToggle(true);
    try {
      await api("/api/v1/merchants/me/config", {
        method: "PUT",
        body: JSON.stringify({ agentOptIn: next }),
      });
      onSaved();
    } catch (err) {
      console.error("Toggle save failed", err);
      setAgentOptIn(!next);
    } finally {
      setSavingToggle(false);
    }
  };

  const saveWebhook = async (e: FormEvent) => {
    e.preventDefault();
    setSavingWebhook(true);
    setWebhookError(null);
    try {
      await api("/api/v1/merchants/me/config", {
        method: "PUT",
        body: JSON.stringify({ webhookUrl: webhookUrl || null }),
      });
      onSaved();
    } catch (err) {
      setWebhookError((err as Error).message);
    } finally {
      setSavingWebhook(false);
    }
  };

  return (
    <div className="space-y-6 stagger-children max-w-2xl">
      <div className="glass rounded-xl p-5">
        <h3 className="font-semibold mb-4">Stytch B2B Session</h3>
        <p className="text-xs text-text-muted mb-3">
          Dashboard calls use <code className="bg-surface-3 px-1 rounded">Authorization: Bearer &lt;session_jwt&gt;</code>.
          API keys remain supported for server-to-server calls.
        </p>
        <div className="space-y-3">
          <div className="text-xs">
            Status:{" "}
            <span className={b2bSessionJwt ? "text-success" : "text-warning"}>
              {b2bSessionJwt ? "Session active" : "No session loaded"}
            </span>
          </div>
          <textarea
            value={sessionInput}
            onChange={(e) => setSessionInput(e.target.value)}
            rows={3}
            placeholder="Paste Stytch B2B session JWT"
            className="w-full bg-surface-3 border border-border rounded-lg px-3 py-2 text-xs font-mono"
          />
          <div className="flex gap-2">
            <button type="button" onClick={onSessionSave} className="px-3 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-xs font-medium transition-colors">
              Save session
            </button>
            <button type="button" onClick={onSessionClear} className="px-3 py-2 rounded-lg bg-surface-3 hover:bg-surface-4 text-xs font-medium transition-colors">
              Clear session
            </button>
          </div>
          {authWarning && <p className="text-xs text-warning">{authWarning}</p>}
        </div>
      </div>

      <div className="glass rounded-xl p-5">
        <h3 className="font-semibold mb-4">API Key</h3>
        <div className="flex items-center gap-3">
          <code className="flex-1 bg-surface-3 rounded-lg px-4 py-3 font-mono text-sm select-all break-all">
            {visible ? apiKey : "••••••••••••••••••••••••••••"}
          </code>
          <button onClick={onToggle} className="px-4 py-3 rounded-lg bg-surface-3 hover:bg-surface-4 text-sm font-medium transition-colors shrink-0">
            {visible ? "Hide" : "Reveal"}
          </button>
          <button onClick={() => navigator.clipboard.writeText(apiKey)} className="px-4 py-3 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium transition-colors shrink-0">
            Copy
          </button>
        </div>
        <p className="text-xs text-text-muted mt-2">
          Use this key in the <code className="bg-surface-3 px-1 rounded">X-API-Key</code> header. Loaded from{" "}
          <code className="bg-surface-3 px-1 rounded">NEXT_PUBLIC_TOKENTO_API_KEY</code>; seeded via{" "}
          <code className="bg-surface-3 px-1 rounded">DEV_FIXED_API_KEY</code>.
        </p>
      </div>

      <div className="glass rounded-xl p-5">
        <h3 className="font-semibold mb-4">Agent Integration</h3>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm">Agent opt-in</p>
            <p className="text-xs text-text-muted">Allow AI agents to discover and present your loyalty tokens</p>
          </div>
          <button
            type="button"
            onClick={flipToggle}
            disabled={savingToggle}
            aria-pressed={agentOptIn}
            className={`w-12 h-7 rounded-full relative transition-colors ${agentOptIn ? "bg-brand-500" : "bg-surface-4"} ${savingToggle ? "opacity-60" : ""}`}
          >
            <span className={`absolute top-0.5 w-6 h-6 rounded-full bg-white shadow transition-transform ${agentOptIn ? "translate-x-5" : "translate-x-0.5"}`} />
          </button>
        </div>
      </div>

      <form onSubmit={saveWebhook} className="glass rounded-xl p-5">
        <h3 className="font-semibold mb-4">Webhook Configuration</h3>
        <div className="space-y-2">
          <label className="text-sm text-text-secondary">Webhook URL</label>
          <input
            type="url"
            value={webhookUrl}
            onChange={(e) => setWebhookUrl(e.target.value)}
            placeholder="https://your-app.com/webhooks/tokento"
            className="w-full bg-surface-3 border border-border rounded-lg px-4 py-3 text-sm placeholder:text-text-muted focus:outline-none focus:border-brand-500 transition-colors"
          />
          <p className="text-xs text-text-muted">
            Receive events: <code className="bg-surface-3 px-1 rounded">token.minted</code>,{" "}
            <code className="bg-surface-3 px-1 rounded">token.redeemed</code>,{" "}
            <code className="bg-surface-3 px-1 rounded">token.expired</code>
          </p>
          {webhookError && <p className="text-xs text-error">{webhookError}</p>}
          <div className="pt-2">
            <button type="submit" disabled={savingWebhook} className="px-4 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium transition-colors disabled:opacity-60">
              {savingWebhook ? "Saving…" : "Save webhook"}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}

/* ---- Demo Wiring ---- */
function DemoTab({ merchant }: { merchant: Merchant | null }) {
  const docsUrl = `${API_BASE}/docs`;
  const openApiSpecUrl = `${API_BASE}/docs/openapi.yaml`;
  const claudeConfig = useMemo(() => JSON.stringify({
    mcpServers: {
      tokento: {
        command: "node",
        args: ["<absolute-path-to>/Token/mcp-proxy.js"],
      },
    },
  }, null, 2), []);

  const curlMint = `curl -X POST ${API_BASE}/api/v1/tokens/mint \\
  -H "X-API-Key: ${API_KEY}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "merchantId": "${merchant?.id || "<merchant-id>"}",
    "customerId": "11111111-1111-1111-1111-111111111111",
    "transactionAmount": 30,
    "earnRuleId": "<earn-rule-id>",
    "idempotencyKey": "demo-mint-1"
  }'`;

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="glass rounded-xl p-5">
        <h3 className="font-semibold mb-2">1 — Confirm the API + MCP are running</h3>
        <p className="text-sm text-text-secondary mb-3">
          API: <code className="bg-surface-3 px-1 rounded">http://localhost:4000/health</code> · MCP Worker:{" "}
          <code className="bg-surface-3 px-1 rounded">http://localhost:8787</code> · Postgres :5433 · Redis :6379
        </p>
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <a
            href={docsUrl}
            target="_blank"
            rel="noreferrer"
            className="px-3 py-1.5 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-xs font-medium transition-colors"
          >
            Open API Docs
          </a>
          <a
            href={openApiSpecUrl}
            target="_blank"
            rel="noreferrer"
            className="px-3 py-1.5 rounded-lg bg-surface-3 hover:bg-surface-4 text-xs font-medium transition-colors"
          >
            OpenAPI YAML
          </a>
        </div>
        <p className="text-xs text-text-muted">
          See the System Status tab for one-click health checks.
        </p>
      </div>

      <div className="glass rounded-xl p-5">
        <h3 className="font-semibold mb-2">2 — Wire Claude Desktop to the MCP proxy</h3>
        <p className="text-sm text-text-secondary mb-3">
          Add this to <code className="bg-surface-3 px-1 rounded">~/Library/Application Support/Claude/claude_desktop_config.json</code> and
          restart Claude Desktop:
        </p>
        <pre className="bg-surface-3 rounded-lg p-4 text-xs font-mono text-text-secondary overflow-x-auto">
{claudeConfig}
        </pre>
        <p className="text-xs text-text-muted mt-3">
          The proxy bridges Claude&apos;s stdio to the local Cloudflare Worker (<code className="bg-surface-3 px-1 rounded">mcp-proxy.js</code>).
        </p>
      </div>

      <div className="glass rounded-xl p-5">
        <h3 className="font-semibold mb-2">3 — Run the demo</h3>
        <ol className="text-sm text-text-secondary space-y-2 list-decimal list-inside">
          <li>Open Claude Desktop. Ask: <em>&quot;I&apos;m shopping at {merchant?.name || "Coffee Co."}. Check my wallet for customer 11111111-1111-1111-1111-111111111111.&quot;</em></li>
          <li>Claude calls <code className="bg-surface-3 px-1 rounded">query_loyalty_tokens</code> via the MCP server.</li>
          <li>Ask Claude to redeem one of the tokens for a $30 transaction.</li>
          <li>Watch this dashboard — the token row will flash and move ACTIVE → REDEEMED, and the Redemptions tab will pick up the new entry within ~50ms via SSE.</li>
        </ol>
      </div>

      <div className="glass rounded-xl p-5">
        <h3 className="font-semibold mb-2">4 — Or mint a token from the CLI</h3>
        <pre className="bg-surface-3 rounded-lg p-4 text-xs font-mono text-text-secondary overflow-x-auto whitespace-pre">
{curlMint}
        </pre>
        <p className="text-xs text-text-muted mt-3">
          The dashboard will receive a <code className="bg-surface-3 px-1 rounded">token.minted</code> event over SSE and update without a refresh.
        </p>
      </div>
    </div>
  );
}

/* ---- System Status ---- */
function StatusTab({
  services,
  status,
  onCheck,
  connection,
}: {
  services: typeof SERVICES;
  status: Record<string, string>;
  onCheck: () => void;
  connection: ConnectionState;
}) {
  return (
    <div className="space-y-6 max-w-2xl animate-slide-up">
      <div className="glass rounded-xl p-5">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm">SSE event stream</p>
            <p className="text-xs text-text-muted">Real-time updates from the API event bus</p>
          </div>
          <StatusDot status={connection === "live" ? "up" : connection === "connecting" ? "checking" : "down"} />
        </div>
      </div>
      <div className="flex items-center justify-between">
        <p className="text-sm text-text-secondary">Check which services are running locally</p>
        <button onClick={onCheck} className="px-4 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium transition-colors">
          Check All
        </button>
      </div>
      <div className="space-y-3">
        {services.map((svc) => (
          <div key={svc.name} className="glass rounded-xl p-5 flex items-center justify-between">
            <div>
              <p className="font-semibold">{svc.name}</p>
              <p className="text-xs text-text-muted font-mono">localhost:{svc.port}</p>
            </div>
            <StatusDot status={status[svc.name]} />
          </div>
        ))}
      </div>
      <div className="glass rounded-xl p-5">
        <h4 className="font-semibold mb-2">Quick Test — MCP Tools</h4>
        <code className="block bg-surface-3 rounded-lg p-4 text-xs font-mono text-text-secondary overflow-x-auto whitespace-pre">{`curl -X POST http://localhost:8787 \\
  -H "Content-Type: application/json" \\
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'`}</code>
      </div>
    </div>
  );
}

/* ---- Shared components ---- */
function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    ACTIVE: "bg-success/10 text-success",
    REDEEMED: "bg-brand-500/10 text-brand-400",
    EXPIRED: "bg-error/10 text-error",
    REJECTED: "bg-error/10 text-error",
    INACTIVE: "bg-surface-3 text-text-muted",
  };
  return <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${colors[status] || colors.INACTIVE}`}>{status}</span>;
}

function StatusDot({ status }: { status?: string }) {
  if (!status) return <span className="text-xs text-text-muted">Not checked</span>;
  if (status === "checking") return (
    <span className="text-xs text-warning flex items-center gap-1.5">
      <span className="w-2 h-2 rounded-full bg-warning pulse-dot" />Checking…
    </span>
  );
  if (status === "up") return (
    <span className="text-xs text-success flex items-center gap-1.5">
      <span className="w-2 h-2 rounded-full bg-success" />Online
    </span>
  );
  return (
    <span className="text-xs text-error flex items-center gap-1.5">
      <span className="w-2 h-2 rounded-full bg-error" />Offline
    </span>
  );
}
