"use client";

import { useEffect, useRef, useState } from "react";

import EventLog from "@/components/EventLog";
import { subscribeToFixJob } from "@/lib/eventStream";
import { pollFixJobUntilTotals } from "@/lib/fixJobs";
import type { Card } from "@/types/cards";
import type { FixJobSummary } from "@/types/fix-job";

// Stable hint mirroring api/src/lib/credits.ts PATCH_COST. The API is the
// source of truth at charge time; this constant only labels the post-refund
// badge after a confirmed terminal-failure SSE event.
const REFUND_AMOUNT_HINT = 5;

type State =
  | { status: "idle" }
  | {
      status: "running";
      fixJobId: string;
      cards: Card[];
      startTs: number;
    }
  | {
      status: "success";
      fixJobId: string;
      cards: Card[];
      startTs: number;
      prUrl: string;
      summaryText: string;
    }
  | {
      status: "error";
      fixJobId?: string;
      cards: Card[];
      startTs: number | null;
      message: string;
    };

interface FixBugButtonProps {
  bugReportId: string;
  ctaLabel?: string;
  // Pushed up to the parent on every status transition so the page-level
  // stepper can advance to Step 4 on success and drop back to Step 3 on
  // retry / Run another. Optional — the legacy ?bug=<id> path renders
  // FixBugButton without a stepper and omits this.
  onStatusChange?: (status: "idle" | "running" | "success" | "error") => void;
  // Fired at every API boundary that can change the demo user's balance:
  // POST /api/fix-jobs (charge), terminal SSE event (refund on failure),
  // and POST /api/fix-jobs/:id/recover (refund or recharge). Owner is
  // page.tsx's useBalance() refresh — this component doesn't read balance.
  onBalanceShouldRefresh?: () => void;
}

export default function FixBugButton({
  bugReportId,
  ctaLabel,
  onStatusChange,
  onBalanceShouldRefresh,
}: FixBugButtonProps) {
  const [state, setState] = useState<State>({ status: "idle" });
  const [refundedAmount, setRefundedAmount] = useState<number | null>(null);
  const [usage, setUsage] = useState<FixJobSummary | null>(null);
  const closeRef = useRef<(() => void) | null>(null);
  // AbortController for the post-terminal pollFixJobUntilTotals call.
  // Cancelled on unmount, on Run another / Retry, and before starting a
  // new fix-job — prevents a stale poll from clobbering fresh state.
  const usageAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      closeRef.current?.();
      usageAbortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    onStatusChange?.(state.status);
  }, [state.status, onStatusChange]);

  // Watchdog for Cloudflare Durable Object hibernation. The DO that owns the
  // agent session can be evicted from memory mid-run (the SDK stream stops
  // delivering events to us, and our setTimeout-based 10min timeout won't
  // fire in that state). When SSE goes quiet for QUIET_THRESHOLD_MS, we poll
  // POST /api/fix-jobs/:id/recover. Recovery is non-destructive for young
  // jobs — see api/src/routes/fixJobs.ts RECOVERY_CUTOFF_SEC. We adopt
  // success only when the endpoint says "succeeded" (PR exists). On
  // "still_running" we keep waiting; on "failed" we transition to error.
  //
  // stateRef pattern: setInterval captures `state` at definition time, so
  // we mirror it into a ref to read the latest cards/fixJobId in the probe
  // without recreating the interval on every card arrival.
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  // Derived dep so the effect's dep array doesn't reach for fixJobId on
  // variants that don't have it (TS narrowing across deps is conservative).
  const runningFixJobId =
    state.status === "running" && state.fixJobId ? state.fixJobId : null;

  useEffect(() => {
    if (!runningFixJobId) return;

    const QUIET_THRESHOLD_MS = 60_000;
    const POLL_INTERVAL_MS = 30_000;
    const apiBase = process.env.NEXT_PUBLIC_API_BASE;
    if (!apiBase) return;

    const probe = async () => {
      const cur = stateRef.current;
      if (cur.status !== "running" || !cur.fixJobId) return;
      const lastCard = cur.cards[cur.cards.length - 1];
      const lastTs = lastCard?.ts ?? cur.startTs;
      if (Date.now() - lastTs < QUIET_THRESHOLD_MS) return;

      let data: {
        status?: string;
        pr_url?: string;
        ended_reason?: string;
        age_seconds?: number;
      };
      try {
        const res = await fetch(
          `${apiBase}/api/fix-jobs/${cur.fixJobId}/recover`,
          { method: "POST" },
        );
        data = (await res.json()) as typeof data;
      } catch (err) {
        if (typeof console !== "undefined") {
          console.warn("[FixBugButton] recovery probe failed", err);
        }
        return;
      }

      // Re-check — live stream may have completed during the await.
      const after = stateRef.current;
      if (after.status !== "running") return;

      if (data.status === "succeeded" && data.pr_url) {
        closeRef.current?.();
        closeRef.current = null;
        setState({
          status: "success",
          fixJobId: after.fixJobId,
          cards: after.cards,
          startTs: after.startTs,
          prUrl: data.pr_url,
          summaryText: "",
        });
        // Recovery may have re-charged a previously-refunded job — refresh
        // so the balance chip reflects the truth.
        onBalanceShouldRefresh?.();
        startUsagePoll(apiBase, after.fixJobId);
      } else if (data.status === "failed") {
        closeRef.current?.();
        closeRef.current = null;
        setRefundedAmount(REFUND_AMOUNT_HINT);
        setState({
          status: "error",
          fixJobId: after.fixJobId,
          cards: after.cards,
          startTs: after.startTs,
          message: `agent did not push branch${
            data.age_seconds ? ` (after ${String(data.age_seconds)}s)` : ""
          }`,
        });
        // Recovery refunded the failed job; refresh to reveal the +5.
        onBalanceShouldRefresh?.();
        startUsagePoll(apiBase, after.fixJobId);
      }
      // "still_running" → keep waiting; next probe in POLL_INTERVAL_MS.
    };

    const interval = setInterval(probe, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
    // onBalanceShouldRefresh is intentionally omitted — it's a stable callback
    // from the parent; including it would re-create the interval on every
    // page render and effectively reset the watchdog timer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runningFixJobId]);

  // Kick off the post-terminal usage poll. Cancels any prior poll first so
  // overlapping clicks (e.g. fast Retry → new run completes → old poll still
  // alive) can't write a stale FixJobSummary into `usage`.
  function startUsagePoll(apiBase: string, fixJobId: string) {
    usageAbortRef.current?.abort();
    const ctrl = new AbortController();
    usageAbortRef.current = ctrl;
    void pollFixJobUntilTotals(apiBase, fixJobId, ctrl.signal).then(
      (summary) => {
        if (ctrl.signal.aborted) return;
        setUsage(summary);
      },
    );
  }

  async function handleClick() {
    const apiBase = process.env.NEXT_PUBLIC_API_BASE;
    if (!apiBase) {
      setState({
        status: "error",
        cards: [],
        startTs: null,
        message: "NEXT_PUBLIC_API_BASE not set in .env.local",
      });
      return;
    }

    const startTs = Date.now();
    setRefundedAmount(null);
    setUsage(null);
    usageAbortRef.current?.abort();
    setState({ status: "running", fixJobId: "", cards: [], startTs });

    try {
      const res = await fetch(`${apiBase}/api/fix-jobs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bug_report_id: bugReportId }),
      });

      if (!res.ok) {
        // 402 is the insufficient_credits gate; render a clearer message
        // than the generic error path and prompt the user to claim more.
        if (res.status === 402) {
          const detail = await extractErrorDetail(res);
          // Refresh in case the balance moved since the chip last rendered.
          onBalanceShouldRefresh?.();
          throw new Error(`${detail} — click "Claim free credits" above.`);
        }
        throw new Error(await extractErrorDetail(res));
      }

      const { fix_job_id, stream_url } = (await res.json()) as {
        fix_job_id: string;
        stream_url: string;
        status: string;
      };

      // Charge happened server-side after the DO started — refresh the
      // chip so the user sees -5.
      onBalanceShouldRefresh?.();

      setState({
        status: "running",
        fixJobId: fix_job_id,
        cards: [],
        startTs,
      });

      const close = subscribeToFixJob(`${apiBase}${stream_url}`, {
        onCard: (card) => {
          setState((prev) => {
            if (prev.status !== "running") return prev;
            return { ...prev, cards: [...prev.cards, card] };
          });
        },
        onComplete: (data) => {
          setState((prev) => {
            const cards =
              prev.status === "running" || prev.status === "success"
                ? prev.cards
                : [];
            const ts =
              prev.status === "running" || prev.status === "success"
                ? prev.startTs
                : startTs;
            return {
              status: "success",
              fixJobId: data.fix_job_id,
              cards,
              startTs: ts,
              prUrl: data.pr_url,
              summaryText: data.summary_text,
            };
          });
          closeRef.current = null;
          // Charge stays in effect on success — refresh keeps the chip
          // accurate in case the user had stale state.
          onBalanceShouldRefresh?.();
          // Fetch the fix-job row with backoff to bridge the "DO finally
          // writes total_*_tokens AFTER the terminal SSE" race.
          startUsagePoll(apiBase, data.fix_job_id);
        },
        onAppError: (data) => {
          // do_start_failed never reaches the DO so was never charged →
          // no refund expected. All other ended_reasons hit a refund path.
          if (data.ended_reason !== "do_start_failed") {
            setRefundedAmount(REFUND_AMOUNT_HINT);
          }
          setState((prev) => {
            const cards = prev.status === "running" ? prev.cards : [];
            const ts = prev.status === "running" ? prev.startTs : startTs;
            return {
              status: "error",
              fixJobId: prev.status === "running" ? prev.fixJobId : undefined,
              cards,
              startTs: ts,
              message: `${data.label} (${data.ended_reason})`,
            };
          });
          closeRef.current = null;
          // Refund landed server-side BEFORE the SSE event was emitted —
          // refresh now reveals the +5.
          onBalanceShouldRefresh?.();
          // Same race as the success path — usage write happens in finally.
          // do_start_failed never created a session, so no totals exist;
          // skip the poll for that ended_reason to avoid 4 wasted GETs.
          const cur = stateRef.current;
          const fid =
            cur.status === "running" && cur.fixJobId ? cur.fixJobId : null;
          if (fid && data.ended_reason !== "do_start_failed") {
            startUsagePoll(apiBase, fid);
          }
        },
        onTransportError: () => {
          if (typeof console !== "undefined") {
            console.warn(
              "[FixBugButton] EventSource transport error (browser will reconnect)",
            );
          }
        },
      });
      closeRef.current = close;
    } catch (err) {
      closeRef.current?.();
      closeRef.current = null;
      setState({
        status: "error",
        cards: [],
        startTs: null,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  function reset() {
    closeRef.current?.();
    closeRef.current = null;
    setState({ status: "idle" });
  }

  /* ── IDLE ─────────────────────────────────────────────── */
  if (state.status === "idle") {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={handleClick}
          className="cp-btn cp-btn-primary"
        >
          <span>
            {ctaLabel ?? (
              <>
                Try CrowdPatch on{" "}
                <span className="font-mono">{bugReportId}</span>
              </>
            )}
          </span>
          <span className="arrow" aria-hidden>
            →
          </span>
        </button>
      </div>
    );
  }

  /* ── RUNNING ──────────────────────────────────────────── */
  if (state.status === "running") {
    return (
      <div className="flex w-full flex-col gap-4">
        <div className="cp-card tint-agent bar-agent pad-md flex items-center gap-3">
          <Spinner />
          <span className="text-base font-600 text-violet-100">
            Agent working…
          </span>
          {state.fixJobId && (
            <span className="ml-auto rounded border border-violet-500/30 bg-ink-950/40 px-2 py-0.5 font-mono text-xs text-violet-200">
              {state.fixJobId.slice(-8).toLowerCase()}
            </span>
          )}
        </div>
        <p className="cp-small">
          Live from the Managed Agent. Typically 1–5 minutes; safe to keep this
          tab open.
        </p>
        <EventLog cards={state.cards} startTs={state.startTs} />
      </div>
    );
  }

  /* ── SUCCESS ──────────────────────────────────────────── */
  if (state.status === "success") {
    const trimmedSummary = state.summaryText.trim();
    return (
      <div className="flex w-full flex-col gap-4">
        {trimmedSummary && (
          <blockquote className="cp-card tint-success bar-success pad-md text-sm text-lime-100">
            <div className="mb-1 font-mono text-xs font-600 uppercase tracking-[0.14em] text-lime-200">
              What Claude changed
            </div>
            <pre className="whitespace-pre-wrap break-words font-sans text-sm text-lime-50">
              {trimmedSummary}
            </pre>
          </blockquote>
        )}
        <a
          href={state.prUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="cp-btn cp-btn-primary w-fit"
          style={{
            background:
              "linear-gradient(135deg, var(--lime-300), var(--lime-400))",
            boxShadow:
              "0 0 0 1px rgb(125 220 26 / .45), 0 10px 28px -6px rgb(125 220 26 / .6)",
          }}
        >
          <span aria-hidden>✓</span>
          <span>View pull request</span>
          <span className="arrow" aria-hidden>
            →
          </span>
        </a>
        <UsageChip usage={usage} />
        <div className="flex items-center gap-3">
          <span className="font-mono text-xs text-ink-300">
            fix_job_id: <span className="text-ink-100">{state.fixJobId}</span>
          </span>
          <button
            type="button"
            onClick={reset}
            className="cp-btn cp-btn-sm cp-btn-ghost"
          >
            Run another
          </button>
        </div>
        <EventLog cards={state.cards} startTs={state.startTs} />
      </div>
    );
  }

  /* ── ERROR ────────────────────────────────────────────── */
  return (
    <div className="flex w-full flex-col gap-4">
      <div className="cp-card tint-danger bar-danger pad-md text-sm text-red-200">
        <strong className="font-600 text-red-100">Fix-job failed.</strong>{" "}
        <span className="font-mono text-xs">{state.message}</span>
      </div>
      {refundedAmount !== null && (
        <span className="inline-flex w-fit items-center gap-1.5 rounded-full border border-lime-500/40 bg-lime-500/[0.10] px-3 py-1 font-mono text-xs font-600 text-lime-100">
          <span
            aria-hidden="true"
            className="h-1.5 w-1.5 rounded-full bg-lime-400 shadow-[0_0_6px] shadow-lime-400"
          />
          Refunded {String(refundedAmount)} credits
        </span>
      )}
      {usage && <UsageChip usage={usage} />}
      <button
        type="button"
        onClick={reset}
        className="cp-btn cp-btn-primary self-start"
      >
        Retry
      </button>
      {state.cards.length > 0 && (
        <EventLog cards={state.cards} startTs={state.startTs} />
      )}
    </div>
  );
}

async function extractErrorDetail(res: Response): Promise<string> {
  try {
    const body: unknown = await res.json();
    if (
      typeof body === "object" &&
      body !== null &&
      "error" in body &&
      typeof (body as { error: unknown }).error === "string"
    ) {
      const errMsg = (body as { error: string }).error;
      const details =
        "details" in body &&
        typeof (body as { details: unknown }).details === "string"
          ? `: ${(body as { details: string }).details}`
          : "";
      return `${errMsg}${details}`;
    }
  } catch {
    // non-JSON response
  }
  return `HTTP ${res.status}`;
}

function Spinner() {
  return (
    <span
      role="status"
      aria-label="Loading"
      className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-violet-500/30 border-t-violet-300"
    />
  );
}

// Compact monospace chip showing cumulative session usage retrieved by the
// AgentSessionDO finally block via sessions.retrieve(). Each token/cache
// field renders `—` if null (poll cap exhausted before the DO persisted) so
// the structure stays consistent. Cost is always populated (stamped at row
// creation, not session-side telemetry).
function UsageChip({ usage }: { usage: FixJobSummary | null }) {
  if (!usage) {
    // Pre-poll-resolution placeholder. Same structure so the panel doesn't
    // shift when the data lands.
    return (
      <span className="font-mono text-xs text-ink-300">
        tokens: <span className="text-ink-200">…</span> · cache:{" "}
        <span className="text-ink-200">…</span>
      </span>
    );
  }
  const fmt = (n: number | null) => (n === null ? "—" : n.toLocaleString());
  return (
    <span className="font-mono text-xs text-ink-300">
      tokens:{" "}
      <span className="text-ink-100">{fmt(usage.total_input_tokens)}</span> in /{" "}
      <span className="text-ink-100">{fmt(usage.total_output_tokens)}</span> out
      · cache:{" "}
      <span className="text-ink-100">
        {fmt(usage.total_cache_creation_input_tokens)}
      </span>{" "}
      created /{" "}
      <span className="text-ink-100">
        {fmt(usage.total_cache_read_input_tokens)}
      </span>{" "}
      read · <span className="text-lime-200">{usage.cost_credits}</span> credits
    </span>
  );
}
