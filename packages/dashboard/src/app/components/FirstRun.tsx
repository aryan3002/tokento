"use client";

/**
 * First-run guidance.
 *
 * A brand-new merchant used to land on an empty dashboard whose only hint was
 * "No tokens yet. Run `pnpm db:seed` to populate." — an instruction written for
 * the developer who built it, not for the merchant reading it.
 *
 * This replaces that with the single narrative that matters: the path to the
 * first time an AI agent redeems one of your rewards. Every step verifies
 * itself from live data, so the page is a status board rather than a checklist
 * someone has to keep in their head.
 */

import { ReactNode } from "react";

type StepState = "done" | "current" | "pending";

export type FirstRunFacts = {
  hasEarnRule: boolean;
  hasToken: boolean;
  hasAgentConnected: boolean;
  hasRedemption: boolean;
};

type Step = {
  n: string;
  title: string;
  /** One sentence on why this step exists at all. */
  why: string;
  state: StepState;
  action?: ReactNode;
};

function stateOf(done: boolean, isCurrent: boolean): StepState {
  if (done) return "done";
  return isCurrent ? "current" : "pending";
}

/** A hand-set step marker: number in the gutter, stamped when complete. */
function Marker({ n, state }: { n: string; state: StepState }) {
  if (state === "done") {
    return (
      <span
        aria-hidden
        className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[2px] border-2 border-brand-500 text-brand-500"
        style={{ transform: "rotate(-6deg)" }}
      >
        <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.5">
          <path d="M4 10.5l4 4 8-9" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    );
  }
  return (
    <span
      aria-hidden
      className={[
        "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[2px] border font-mono text-xs",
        state === "current"
          ? "border-text-primary text-text-primary"
          : "border-border text-text-muted",
      ].join(" ")}
    >
      {n}
    </span>
  );
}

export function FirstRun({
  facts,
  onGoToRules,
  onGoToDemo,
  merchantName,
}: {
  facts: FirstRunFacts;
  onGoToRules: () => void;
  onGoToDemo: () => void;
  merchantName?: string;
}) {
  const { hasEarnRule, hasToken, hasAgentConnected, hasRedemption } = facts;

  // The first incomplete step is the current one; everything after it waits.
  const firstIncomplete = !hasEarnRule ? 0 : !hasToken ? 1 : !hasAgentConnected ? 2 : !hasRedemption ? 3 : -1;

  const steps: Step[] = [
    {
      n: "01",
      title: "Define how a purchase becomes a reward",
      why: "An earn rule is the standing instruction: spend this much, receive a token worth that much.",
      state: stateOf(hasEarnRule, firstIncomplete === 0),
      action: (
        <button
          onClick={onGoToRules}
          className="rounded-[2px] bg-text-primary px-4 py-2 font-mono text-xs uppercase tracking-[0.14em] text-surface-1 transition-colors hover:bg-brand-600"
        >
          Create an earn rule
        </button>
      ),
    },
    {
      n: "02",
      title: "Issue your first token",
      why: "Tokens are minted against a real transaction. One API call at the moment a customer earns something.",
      state: stateOf(hasToken, firstIncomplete === 1),
      action: <MintSnippet />,
    },
    {
      n: "03",
      title: "Let an agent see the wallet",
      why: "Point an AI assistant at your Tokento adapter. It discovers the customer's tokens through one interface, whatever protocol it speaks.",
      state: stateOf(hasAgentConnected, firstIncomplete === 2),
      action: (
        <button
          onClick={onGoToDemo}
          className="rounded-[2px] border border-text-primary px-4 py-2 font-mono text-xs uppercase tracking-[0.14em] text-text-primary transition-colors hover:bg-surface-3"
        >
          Wiring instructions
        </button>
      ),
    },
    {
      n: "04",
      title: "Watch a token get redeemed",
      why: "Ask the agent to apply a reward. This page updates the moment it happens — no refresh.",
      state: stateOf(hasRedemption, firstIncomplete === 3),
      action: (
        <p className="font-mono text-xs text-text-muted">
          Try: <span className="text-text-secondary">&ldquo;check my loyalty wallet, then redeem the $5 token&rdquo;</span>
        </p>
      ),
    },
  ];

  const completed = steps.filter((s) => s.state === "done").length;

  return (
    <section className="animate-slide-up">
      {/* Masthead */}
      <div className="mb-8 max-w-2xl">
        <p className="folio mb-3">
          {merchantName ? `${merchantName} · ` : ""}Getting started
        </p>
        <h2 className="text-4xl leading-[1.05] tracking-tight text-text-primary sm:text-5xl">
          Four steps to your first{" "}
          <span className="italic text-brand-500">agent redemption</span>.
        </h2>
        <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-text-secondary">
          Nothing here is live yet. That is expected — this ledger fills itself in as
          you go, and the last step is the one that proves the whole thing works.
        </p>
      </div>

      <hr className="ink-rule mb-8" />

      {/* Progress, set as a printed folio rather than a progress bar */}
      <div className="mb-10 flex items-baseline gap-3">
        <span className="font-mono text-xs tracking-[0.14em] text-text-muted">
          {String(completed).padStart(2, "0")} / 04 COMPLETE
        </span>
        <span className="flex-1">
          <span className="flex h-[3px] gap-1">
            {steps.map((s, i) => (
              <span
                key={i}
                className={[
                  "flex-1 rounded-full transition-colors duration-500",
                  s.state === "done" ? "bg-brand-500" : "bg-border",
                ].join(" ")}
              />
            ))}
          </span>
        </span>
      </div>

      <ol className="space-y-0">
        {steps.map((step, i) => {
          const isCurrent = step.state === "current";
          const isDone = step.state === "done";
          return (
            <li
              key={step.n}
              className={[
                "grid grid-cols-[auto_1fr] gap-x-5 border-b border-border py-6",
                i === 0 ? "border-t" : "",
                isDone ? "opacity-55" : "",
              ].join(" ")}
            >
              <Marker n={step.n} state={step.state} />

              <div className="min-w-0">
                <h3
                  className={[
                    "text-lg leading-snug",
                    isCurrent ? "text-text-primary" : "text-text-secondary",
                    isDone ? "line-through decoration-border" : "",
                  ].join(" ")}
                >
                  {step.title}
                </h3>

                {/* Only the step you are actually on explains itself. */}
                {isCurrent && (
                  <>
                    <p className="mt-2 max-w-xl text-sm leading-relaxed text-text-secondary">
                      {step.why}
                    </p>
                    <div className="mt-4">{step.action}</div>
                  </>
                )}

                {isDone && (
                  <p className="mt-1 font-mono text-xs tracking-wide text-brand-500">
                    Done
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ol>

      <p className="mt-8 max-w-xl text-xs leading-relaxed text-text-muted">
        Everything on this deployment is sandbox data. No real money moves — settlement
        is not implemented yet.
      </p>
    </section>
  );
}

/** The mint call, set like printed code in a journal. */
function MintSnippet() {
  return (
    <div className="max-w-xl overflow-x-auto rounded-[2px] border border-border bg-surface-2 p-4">
      <p className="folio mb-2">POST /api/v1/tokens/mint</p>
      <pre className="font-mono text-xs leading-relaxed text-text-secondary">
{`curl -X POST http://localhost:4000/api/v1/tokens/mint \\
  -H "X-API-Key: $TOKENTO_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "customerId": "<your-customer-id>",
    "transactionAmount": 30,
    "earnRuleId": "<earn-rule-id>",
    "idempotencyKey": "first-mint-1"
  }'`}
      </pre>
    </div>
  );
}
