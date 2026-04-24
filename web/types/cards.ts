// Mirrors api/src/lib/eventMapper.ts Card type. Hand-synced for hackathon
// (small enough that copy-paste is fine; Day 3+ could publish a shared package).
//
// Wire contract: see .agents/plans/sequential-soaring-plum.md §"SSE wire contract".

export type Card =
  | { kind: "kickoff"; label: string; ts: number }
  | { kind: "explore"; label: string; ts: number }
  | { kind: "install"; label: string; ts: number }
  | {
      kind: "test";
      label: string;
      status: "running" | "pass" | "fail";
      ts: number;
    }
  | { kind: "read"; label: string; path: string; ts: number }
  | { kind: "edit"; label: string; path: string; ts: number }
  | { kind: "commit"; label: string; ts: number }
  | { kind: "push"; label: string; ts: number }
  | { kind: "thought"; label: string; text: string; ts: number }
  | {
      kind: "pr_opened";
      label: string;
      pr_url: string;
      pr_number: number;
      ts: number;
    }
  | {
      kind: "complete";
      label: string;
      pr_url: string;
      fix_job_id: string;
      ended_reason: string;
      ts: number;
    }
  | {
      kind: "error_event";
      label: string;
      ended_reason: string;
      ts: number;
    };

export type CardKind = Card["kind"];

// All progress event names emitted by AgentSessionDO before terminal events.
// Each maps to a SSE event name (event: <kind>).
export const PROGRESS_KINDS = [
  "kickoff",
  "explore",
  "install",
  "test",
  "read",
  "edit",
  "commit",
  "push",
  "thought",
  "pr_opened",
] as const;
