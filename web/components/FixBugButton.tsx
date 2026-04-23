"use client";

import { useState } from "react";

type State =
  | { status: "idle" }
  | { status: "running" }
  | { status: "success"; prUrl: string; fixJobId: string }
  | { status: "error"; message: string };

interface FixBugButtonProps {
  bugReportId: string;
}

export default function FixBugButton({ bugReportId }: FixBugButtonProps) {
  const [state, setState] = useState<State>({ status: "idle" });

  async function handleClick() {
    setState({ status: "running" });
    try {
      const apiBase = process.env.NEXT_PUBLIC_API_BASE;
      if (!apiBase) {
        throw new Error("NEXT_PUBLIC_API_BASE not set in .env.local");
      }

      const res = await fetch(`${apiBase}/api/fix-jobs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bug_report_id: bugReportId }),
      });

      if (!res.ok) {
        throw new Error(await extractErrorDetail(res));
      }

      const data = (await res.json()) as {
        fix_job_id: string;
        pr_url: string;
        status: string;
      };
      setState({
        status: "success",
        prUrl: data.pr_url,
        fixJobId: data.fix_job_id,
      });
    } catch (err) {
      setState({
        status: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
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
      <div className="flex flex-col items-center gap-3 sm:items-start">
        <div className="flex items-center gap-3">
          <Spinner />
          <span className="text-base font-medium text-zinc-900 dark:text-zinc-100">
            Agent working…
          </span>
        </div>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          {`This typically takes 1–5 minutes. Don't close this tab.`}
        </p>
      </div>
    );
  }

  if (state.status === "success") {
    return (
      <div className="flex flex-col items-center gap-3 sm:items-start">
        <a
          href={state.prUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-lg bg-emerald-600 px-6 py-3 text-base font-medium text-white shadow-sm transition-colors hover:bg-emerald-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600"
        >
          ✓ View pull request →
        </a>
        <p className="font-mono text-xs text-zinc-500">
          fix_job_id: {state.fixJobId}
        </p>
        <button
          type="button"
          onClick={() => {
            setState({ status: "idle" });
          }}
          className="text-sm text-zinc-600 underline-offset-4 hover:underline dark:text-zinc-400"
        >
          Run another
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-stretch gap-3 sm:items-start">
      <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
        <strong className="font-medium">Fix-job failed.</strong>{" "}
        <span className="font-mono text-xs">{state.message}</span>
      </div>
      <button
        type="button"
        onClick={() => {
          setState({ status: "idle" });
        }}
        className="self-start rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-900 transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800"
      >
        Retry
      </button>
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
