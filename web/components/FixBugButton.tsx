"use client";

import { useEffect, useRef, useState } from "react";

import EventLog from "@/components/EventLog";
import { subscribeToFixJob } from "@/lib/eventStream";
import type { Card } from "@/types/cards";

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
}

export default function FixBugButton({
  bugReportId,
  ctaLabel,
}: FixBugButtonProps) {
  const [state, setState] = useState<State>({ status: "idle" });
  const closeRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    return () => {
      closeRef.current?.();
    };
  }, []);

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
    setState({ status: "running", fixJobId: "", cards: [], startTs });

    try {
      const res = await fetch(`${apiBase}/api/fix-jobs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bug_report_id: bugReportId }),
      });

      if (!res.ok) {
        throw new Error(await extractErrorDetail(res));
      }

      const { fix_job_id, stream_url } = (await res.json()) as {
        fix_job_id: string;
        stream_url: string;
        status: string;
      };

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
        },
        onAppError: (data) => {
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
      <button
        type="button"
        onClick={handleClick}
        className="group relative inline-flex items-center gap-2 overflow-hidden rounded-lg bg-orange-500 px-6 py-3.5 text-base font-600 text-ink-black shadow-[0_0_0_1px_rgba(255,124,43,.4),0_8px_24px_-8px_rgba(255,92,10,.6)] transition-all hover:bg-orange-400 hover:shadow-[0_0_0_1px_rgba(255,154,94,.6),0_12px_32px_-8px_rgba(255,92,10,.8)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-400 active:translate-y-px"
      >
        <span>
          {ctaLabel ?? (
            <>
              Try CrowdPatch on <span className="font-mono">{bugReportId}</span>
            </>
          )}
        </span>
        <span className="transition-transform group-hover:translate-x-0.5">
          →
        </span>
      </button>
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
