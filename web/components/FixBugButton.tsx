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
}

export default function FixBugButton({ bugReportId }: FixBugButtonProps) {
  const [state, setState] = useState<State>({ status: "idle" });
  const closeRef = useRef<(() => void) | null>(null);

  // Tear down EventSource if the component unmounts mid-run.
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

      // Subscribe to live SSE stream of semantic event cards.
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
          // Browser auto-reconnects on transport errors; just log.
          // Not terminal — only error_event closes the UI.
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

  if (state.status === "idle") {
    return (
      <button
        type="button"
        onClick={handleClick}
        className="rounded-lg bg-zinc-900 px-6 py-3 text-base font-medium text-white shadow-sm transition-colors hover:bg-zinc-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 dark:bg-white dark:text-black dark:hover:bg-zinc-200 dark:focus-visible:outline-white"
      >
        Try CrowdPatch on {bugReportId} →
      </button>
    );
  }

  if (state.status === "running") {
    return (
      <div className="flex w-full flex-col gap-4">
        <div className="flex items-center gap-3">
          <Spinner />
          <span className="text-base font-medium text-zinc-900 dark:text-zinc-100">
            Agent working…
          </span>
          {state.fixJobId && (
            <span className="font-mono text-xs text-zinc-500 dark:text-zinc-500">
              {state.fixJobId.slice(-8).toLowerCase()}
            </span>
          )}
        </div>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          {`Live from the Managed Agent. Typically 1–5 minutes; safe to keep this tab open.`}
        </p>
        <EventLog cards={state.cards} startTs={state.startTs} />
      </div>
    );
  }

  if (state.status === "success") {
    return (
      <div className="flex w-full flex-col gap-4">
        <a
          href={state.prUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="self-start rounded-lg bg-emerald-600 px-6 py-3 text-base font-medium text-white shadow-sm transition-colors hover:bg-emerald-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600"
        >
          ✓ View pull request →
        </a>
        <div className="flex items-center gap-3">
          <span className="font-mono text-xs text-zinc-500 dark:text-zinc-500">
            fix_job_id: {state.fixJobId}
          </span>
          <button
            type="button"
            onClick={reset}
            className="text-sm text-zinc-600 underline-offset-4 hover:underline dark:text-zinc-400"
          >
            Run another
          </button>
        </div>
        <EventLog cards={state.cards} startTs={state.startTs} />
      </div>
    );
  }

  return (
    <div className="flex w-full flex-col gap-4">
      <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
        <strong className="font-medium">Fix-job failed.</strong>{" "}
        <span className="font-mono text-xs">{state.message}</span>
      </div>
      <button
        type="button"
        onClick={reset}
        className="self-start rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-900 transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800"
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
    // non-JSON response — fall through
  }
  return `HTTP ${res.status}`;
}

function Spinner() {
  return (
    <span
      role="status"
      aria-label="Loading"
      className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-900 dark:border-zinc-700 dark:border-t-zinc-100"
    />
  );
}
