"use client";

import { useEffect, useRef, useState } from "react";

import EventLog from "@/components/EventLog";
import { subscribeToFixJob } from "@/lib/eventStream";
import type { Card } from "@/types/cards";

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
  const closeRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    return () => {
      closeRef.current?.();
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
          className="group relative inline-flex items-center gap-2 overflow-hidden rounded-lg bg-orange-500 px-6 py-3.5 text-base font-600 text-ink-black shadow-[0_0_0_1px_rgba(255,124,43,.4),0_8px_24px_-8px_rgba(255,92,10,.6)] transition-all hover:bg-orange-400 hover:shadow-[0_0_0_1px_rgba(255,154,94,.6),0_12px_32px_-8px_rgba(255,92,10,.8)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-400 active:translate-y-px"
        >
          <span>
            {ctaLabel ?? (
              <>
                Try CrowdPatch on{" "}
                <span className="font-mono">{bugReportId}</span>
              </>
            )}
          </span>
          <span className="transition-transform group-hover:translate-x-0.5">
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
        <div className="flex items-center gap-3 rounded-lg border border-violet-500/30 bg-violet-500/[0.08] px-4 py-3">
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
        <p className="text-sm text-ink-200">
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
          <blockquote className="rounded-lg border-l-4 border-lime-500/60 bg-lime-500/[0.08] px-4 py-3 text-sm text-lime-100">
            <div className="mb-1 text-xs font-600 uppercase tracking-[0.12em] text-lime-200">
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
          className="group relative inline-flex w-fit items-center gap-2 rounded-lg bg-lime-400 px-6 py-3.5 text-base font-700 text-ink-black shadow-[0_0_0_1px_rgba(154,239,58,.5),0_8px_24px_-8px_rgba(125,220,26,.7)] transition-all hover:bg-lime-300 hover:shadow-[0_0_0_1px_rgba(196,248,122,.7),0_12px_32px_-8px_rgba(125,220,26,.9)]"
        >
          <span aria-hidden="true">✓</span>
          <span>View pull request</span>
          <span className="transition-transform group-hover:translate-x-0.5">
            →
          </span>
        </a>
        <div className="flex items-center gap-3">
          <span className="font-mono text-xs text-ink-300">
            fix_job_id: <span className="text-ink-100">{state.fixJobId}</span>
          </span>
          <button
            type="button"
            onClick={reset}
            className="text-sm text-orange-400 underline-offset-4 hover:underline"
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
      <div className="rounded-lg border border-red-500/40 bg-red-500/[0.10] px-4 py-3 text-sm text-red-200">
        <strong className="font-600 text-red-100">Fix-job failed.</strong>{" "}
        <span className="font-mono text-xs">{state.message}</span>
      </div>
      {refundedAmount !== null && (
        <span className="inline-flex w-fit items-center gap-1.5 rounded-full border border-lime-500/40 bg-lime-500/[0.10] px-3 py-1 text-xs font-600 text-lime-100">
          <span
            aria-hidden="true"
            className="h-1.5 w-1.5 rounded-full bg-lime-400 shadow-[0_0_6px] shadow-lime-400"
          />
          Refunded {String(refundedAmount)} credits
        </span>
      )}
      <button
        type="button"
        onClick={reset}
        className="self-start rounded-lg border border-ink-700 bg-ink-900 px-4 py-2 text-sm font-500 text-ink-100 transition-colors hover:border-orange-500/50 hover:bg-ink-800 hover:text-orange-300"
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
