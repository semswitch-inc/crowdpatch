"use client";

import { useState } from "react";

import type { SubmittedBug } from "@/types/submitted-bug";

interface SubmittedBugCardProps {
  bug: SubmittedBug;
  onEdit?: () => void;
}

const SEVERITY_TINT: Record<SubmittedBug["severity"], string> = {
  low: "border-cyan-500/40 bg-cyan-500/[0.10] text-cyan-100",
  medium: "border-orange-500/40 bg-orange-500/[0.10] text-orange-100",
  high: "border-red-500/40 bg-red-500/[0.10] text-red-100",
};

export default function SubmittedBugCard({
  bug,
  onEdit,
}: SubmittedBugCardProps) {
  const [expanded, setExpanded] = useState(false);
  const previewLimit = 240;
  const needsToggle = bug.description.length > previewLimit;
  const shown =
    expanded || !needsToggle
      ? bug.description
      : `${bug.description.slice(0, previewLimit).trimEnd()}…`;

  return (
    <article className="flex w-full flex-col gap-3 rounded-xl border border-violet-500/30 bg-violet-500/[0.06] px-5 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <span className="text-xs font-600 uppercase tracking-[0.12em] text-violet-200">
            Bug report saved
          </span>
          <h3 className="text-base font-600 text-ink-50">{bug.title}</h3>
          <span className="font-mono text-xs text-ink-400">{bug.id}</span>
        </div>
        <span
          className={`shrink-0 rounded-full border px-2 py-0.5 text-xs font-600 ${SEVERITY_TINT[bug.severity]}`}
        >
          {bug.severity}
        </span>
      </div>

      <div className="flex flex-col gap-1">
        <span className="text-xs font-600 uppercase tracking-[0.12em] text-ink-300">
          Reporter
        </span>
        <span className="text-sm text-ink-100">{bug.reporter_name}</span>
      </div>

      <div className="flex flex-col gap-1">
        <span className="text-xs font-600 uppercase tracking-[0.12em] text-ink-300">
          Description
        </span>
        <pre className="whitespace-pre-wrap break-words rounded-md border border-ink-700 bg-ink-950/60 p-3 font-mono text-xs text-ink-100">
          {shown}
        </pre>
        {needsToggle && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="self-start text-xs text-violet-300 underline-offset-2 hover:underline"
          >
            {expanded ? "Hide full report" : "Show full report"}
          </button>
        )}
      </div>

      {onEdit && (
        <button
          type="button"
          onClick={onEdit}
          className="self-start text-xs text-orange-400 underline-offset-2 hover:underline"
        >
          Edit and submit a different report
        </button>
      )}
    </article>
  );
}
