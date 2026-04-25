import type { LucideIconName } from "./LucideIcon";

export type TimelineEvent = {
  kind: string;
  icon: LucideIconName;
  label: string;
  meta: string;
  dur: number;
  stage: string;
};

export type Stage = {
  id: string;
  label: string;
  icon: LucideIconName;
};

export const FIX_JOB_TIMELINE: TimelineEvent[] = [
  {
    kind: "kickoff",
    icon: "sparkles",
    label: "Managed Agent woke up",
    meta: "fix_job_id: a8c12f31",
    dur: 900,
    stage: "kickoff",
  },
  {
    kind: "explore",
    icon: "folder-search",
    label: "Cloning sandbox",
    meta: "indie-todos @ HEAD",
    dur: 900,
    stage: "kickoff",
  },
  {
    kind: "thinking",
    icon: "message-square",
    label: "Reading bug report bug_204",
    meta: '"Drag-reorder loses item on drop"',
    dur: 1100,
    stage: "diagnose",
  },
  {
    kind: "explore",
    icon: "folder-search",
    label: "Tracing call sites for handleDrop",
    meta: "src/lists/Board.tsx",
    dur: 900,
    stage: "diagnose",
  },
  {
    kind: "test",
    icon: "test-tube",
    label: "Reproducing failure",
    meta: "vitest run",
    dur: 1000,
    stage: "diagnose",
  },
  {
    kind: "thinking",
    icon: "message-square",
    label: "Likely cause: stale closure on drop()",
    meta: "useCallback dep missing",
    dur: 1100,
    stage: "diagnose",
  },
  {
    kind: "edit",
    icon: "pencil-line",
    label: "Patching Board.tsx",
    meta: "+9 −4",
    dur: 1100,
    stage: "patch",
  },
  {
    kind: "test",
    icon: "test-tube",
    label: "Re-running suite",
    meta: "47 tests",
    dur: 1000,
    stage: "patch",
  },
  {
    kind: "test pass",
    icon: "test-tube",
    label: "All tests pass",
    meta: "47/47 ✓",
    dur: 900,
    stage: "patch",
  },
  {
    kind: "commit",
    icon: "git-commit",
    label: "Committing patch",
    meta: "fix(board): stale drop closure",
    dur: 800,
    stage: "ship",
  },
  {
    kind: "push",
    icon: "upload",
    label: "Pushing crowdpatch/bug-204",
    meta: "remote: github.com/…",
    dur: 800,
    stage: "ship",
  },
  {
    kind: "pr",
    icon: "git-pull-request",
    label: "PR opened — ready for review",
    meta: "#312 · merged in 1m 47s · ◈ +30",
    dur: 2200,
    stage: "ship",
  },
];

export const FIX_JOB_STAGES: Stage[] = [
  { id: "kickoff", label: "01 · Isolate: Sandbox the repo", icon: "shield" },
  {
    id: "diagnose",
    label: "02 · Diagnose: Reproduce the failure",
    icon: "test-tube",
  },
  { id: "patch", label: "03 · Execute: Patch and verify", icon: "pencil-line" },
  {
    id: "ship",
    label: "04 · Deliver: Open a verified PR",
    icon: "git-pull-request",
  },
];
