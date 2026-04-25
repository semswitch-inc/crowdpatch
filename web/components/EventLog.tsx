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
      <div className="text-sm text-zinc-500 dark:text-zinc-500">
        Waiting for first event…
      </div>
    );
  }

  return (
    <ol className="flex flex-col gap-2 font-mono text-sm">
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
      className={`flex items-start gap-3 rounded-md border px-3 py-2 ${visual.container}`}
    >
      <Icon
        className={`mt-0.5 h-4 w-4 shrink-0 ${visual.icon_color}`}
        aria-hidden="true"
      />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-baseline justify-between gap-3">
          <span className={`truncate ${visual.label_color}`}>{card.label}</span>
          <span className="shrink-0 text-xs text-zinc-500 dark:text-zinc-500">
            {offset}
          </span>
        </div>

        {isThought && (
          <button
            type="button"
            onClick={() => {
              setExpanded((v) => !v);
            }}
            className="self-start text-xs text-zinc-500 underline-offset-2 hover:underline dark:text-zinc-400"
          >
            {expanded ? "Hide" : "Show"} reasoning
          </button>
        )}
        {isThought && expanded && (
          <pre className="whitespace-pre-wrap break-words text-xs text-zinc-700 dark:text-zinc-300">
            {card.text}
          </pre>
        )}

        {(isComplete || isPrOpened) && (
          <a
            href={card.pr_url}
            target="_blank"
            rel="noopener noreferrer"
            className="self-start text-xs text-emerald-700 underline-offset-2 hover:underline dark:text-emerald-400"
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

function visualForKind(card: Card): Visual {
  const zinc: Visual = {
    icon: Sparkles,
    icon_color: "text-zinc-500 dark:text-zinc-400",
    label_color: "text-zinc-800 dark:text-zinc-200",
    container: "border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950",
  };
  const blue: Visual = {
    icon: GitCommit,
    icon_color: "text-blue-600 dark:text-blue-400",
    label_color: "text-blue-900 dark:text-blue-200",
    container:
      "border-blue-200 bg-blue-50 dark:border-blue-900 dark:bg-blue-950",
  };
  const emerald: Visual = {
    icon: CheckCircle2,
    icon_color: "text-emerald-600 dark:text-emerald-400",
    label_color: "text-emerald-900 dark:text-emerald-200",
    container:
      "border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950",
  };
  const red: Visual = {
    icon: XCircle,
    icon_color: "text-red-600 dark:text-red-400",
    label_color: "text-red-900 dark:text-red-200",
    container: "border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950",
  };

  switch (card.kind) {
    case "kickoff":
      return { ...zinc, icon: Sparkles };
    case "explore":
      return { ...zinc, icon: FolderSearch };
    case "install":
      return { ...zinc, icon: Package };
    case "test": {
      if (card.status === "pass") return { ...emerald, icon: TestTube };
      if (card.status === "fail") return { ...red, icon: TestTube };
      return {
        icon: TestTube,
        icon_color: "text-amber-600 dark:text-amber-400",
        label_color: "text-amber-900 dark:text-amber-200",
        container:
          "border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950",
      };
    }
    case "read":
      return { ...zinc, icon: BookOpen };
    case "edit":
      return { ...blue, icon: PencilLine };
    case "commit":
      return { ...blue, icon: GitCommit };
    case "push":
      return { ...blue, icon: Upload };
    case "thought":
      return { ...zinc, icon: MessageSquare };
    case "pr_opened":
      return { ...emerald, icon: GitPullRequest };
    case "complete":
      return { ...emerald, icon: CheckCircle2 };
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
