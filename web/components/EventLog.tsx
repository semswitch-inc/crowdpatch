"use client";

import {
  BookOpen,
  CheckCircle2,
  FolderSearch,
  GitCommit,
  GitPullRequest,
  MessageSquare,
  Package,
  PencilLine,
  Sparkles,
  TestTube,
  Upload,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { useState } from "react";

import type { Card } from "@/types/cards";

interface EventLogProps {
  cards: Card[];
  startTs: number | null;
}

export default function EventLog({ cards, startTs }: EventLogProps) {
  if (cards.length === 0) {
    return (
      <div className="font-mono text-sm text-ink-300">
        Waiting for first event…
      </div>
    );
  }

  return (
    <ol className="flex flex-col gap-1.5 font-mono text-sm">
      {cards.map((card, idx) => (
        <CardRow
          key={`${card.kind}-${card.ts}-${idx}`}
          card={card}
          startTs={startTs}
        />
      ))}
    </ol>
  );
}

function CardRow({ card, startTs }: { card: Card; startTs: number | null }) {
  const [expanded, setExpanded] = useState(false);
  const visual = visualForKind(card);
  const Icon = visual.icon;
  const offset = startTs ? formatOffset(card.ts - startTs) : "";
  const isThought = card.kind === "thought";
  const isComplete = card.kind === "complete";
  const isPrOpened = card.kind === "pr_opened";

  return (
    <li
      className={`flex items-start gap-3 rounded-md border px-3 py-2 transition-colors ${visual.container}`}
    >
      <Icon
        className={`mt-0.5 h-4 w-4 shrink-0 ${visual.icon_color}`}
        aria-hidden="true"
      />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-baseline justify-between gap-3">
          <span className={`truncate font-500 ${visual.label_color}`}>
            {card.label}
          </span>
          <span className="shrink-0 text-xs tabular-nums text-ink-300">
            {offset}
          </span>
        </div>

        {isThought && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="self-start text-xs text-violet-300 underline-offset-2 hover:underline"
          >
            {expanded ? "Hide" : "Show"} reasoning
          </button>
        )}
        {isThought && expanded && (
          <pre className="whitespace-pre-wrap break-words rounded border border-ink-700 bg-ink-900/60 p-2 text-xs text-ink-100">
            {card.text}
          </pre>
        )}

        {(isComplete || isPrOpened) && (
          <a
            href={card.pr_url}
            target="_blank"
            rel="noopener noreferrer"
            className="self-start text-xs text-lime-300 underline-offset-2 hover:underline"
          >
            {isComplete
              ? `View PR: ${card.pr_url}`
              : `PR opened: ${card.pr_url}`}
          </a>
        )}
      </div>
    </li>
  );
}

interface Visual {
  icon: LucideIcon;
  icon_color: string;
  label_color: string;
  container: string;
}

/* ───────────────────────────────────────────────────────────
 * Tone palette — vibrant on dark.
 * Each container uses a tinted bg + matching border + shadow inset
 * so the row reads as a single colored chip, not a grey card.
 * ─────────────────────────────────────────────────────────── */
function visualForKind(card: Card): Visual {
  const neutral: Visual = {
    icon: Sparkles,
    icon_color: "text-ink-300",
    label_color: "text-ink-100",
    container: "border-ink-700 bg-ink-900/60",
  };
  const violet: Visual = {
    icon: GitCommit,
    icon_color: "text-violet-300",
    label_color: "text-violet-100",
    container: "border-violet-500/30 bg-violet-500/[0.08]",
  };
  const lime: Visual = {
    icon: CheckCircle2,
    icon_color: "text-lime-300",
    label_color: "text-lime-100",
    container: "border-lime-500/30 bg-lime-500/[0.08]",
  };
  const orange: Visual = {
    icon: TestTube,
    icon_color: "text-orange-300",
    label_color: "text-orange-100",
    container: "border-orange-500/30 bg-orange-500/[0.08]",
  };
  const cyan: Visual = {
    icon: BookOpen,
    icon_color: "text-cyan-300",
    label_color: "text-cyan-100",
    container: "border-cyan-500/30 bg-cyan-500/[0.08]",
  };
  const red: Visual = {
    icon: XCircle,
    icon_color: "text-red-400",
    label_color: "text-red-200",
    container: "border-red-500/40 bg-red-500/[0.10]",
  };

  switch (card.kind) {
    case "kickoff":
      return { ...orange, icon: Sparkles };
    case "explore":
      return { ...cyan, icon: FolderSearch };
    case "install":
      return { ...neutral, icon: Package };
    case "test": {
      if (card.status === "pass") return { ...lime, icon: TestTube };
      if (card.status === "fail") return { ...red, icon: TestTube };
      return { ...orange, icon: TestTube };
    }
    case "read":
      return { ...cyan, icon: BookOpen };
    case "edit":
      return { ...violet, icon: PencilLine };
    case "commit":
      return { ...violet, icon: GitCommit };
    case "push":
      return { ...violet, icon: Upload };
    case "thought":
      return { ...neutral, icon: MessageSquare };
    case "pr_opened":
      return { ...lime, icon: GitPullRequest };
    case "complete":
      return { ...lime, icon: CheckCircle2 };
    case "error_event":
      return { ...red, icon: XCircle };
  }
}

function formatOffset(ms: number): string {
  if (ms < 0) return "+0:00";
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `+${min}:${sec.toString().padStart(2, "0")}`;
}
