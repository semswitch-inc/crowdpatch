// Anthropic Managed Agents event → semantic Card mapping.
//
// The SDK event union is wide (and may evolve), and we don't need exact
// types — we extract a few well-known fields when present and return null
// for anything we don't recognize. Returning null keeps the UI clean by
// dropping noise instead of leaking raw payloads.
//
// Lifecycle events (kickoff, complete, error_event) are constructed
// directly inside AgentSessionDO; this mapper handles per-step agent events.
//
// Wire contract: see .agents/plans/sequential-soaring-plum.md §"SSE wire contract".

import { redact } from "./redact";

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

// Permissive shape — we don't import SDK types because the union changes
// across SDK versions and we only ever poke at a handful of fields.
type AnyEvent = {
  type?: string;
  name?: string;
  input?: Record<string, unknown>;
  content?: Array<{ type?: string; text?: string }>;
  [key: string]: unknown;
};

export function mapAgentEvent(event: unknown): Card | null {
  const ts = Date.now();
  const e = event as AnyEvent;
  if (!e || typeof e.type !== "string") return null;

  if (e.type === "agent.tool_use") {
    const input = (e.input ?? {}) as Record<string, unknown>;
    if (e.name === "bash") {
      const cmd = String(input.command ?? "");
      if (/yarn\s+install|npm\s+install|corepack/.test(cmd)) {
        return { kind: "install", label: "Installing dependencies", ts };
      }
      if (/yarn\s+test|npx?\s+mocha/.test(cmd)) {
        return {
          kind: "test",
          label: "Running test suite",
          status: "running",
          ts,
        };
      }
      if (/git\s+commit/.test(cmd)) {
        return { kind: "commit", label: "Committing fix", ts };
      }
      if (/git\s+push/.test(cmd)) {
        return { kind: "push", label: "Pushing branch", ts };
      }
      if (/^(ls|cat|cd|pwd|find|grep|head|tail|wc)/.test(cmd.trim())) {
        return { kind: "explore", label: "Exploring repository", ts };
      }
      return null;
    }
    if (e.name === "str_replace_editor" || e.name === "text_editor") {
      const path = String(input.path ?? "");
      const cmd = String(input.command ?? "");
      if (cmd === "view") {
        return { kind: "read", label: `Reading ${path}`, path, ts };
      }
      if (cmd === "str_replace" || cmd === "create" || cmd === "insert") {
        return { kind: "edit", label: `Editing ${path}`, path, ts };
      }
      return null;
    }
    return null;
  }

  if (e.type === "agent.message") {
    const blocks = Array.isArray(e.content) ? e.content : [];
    const raw = blocks
      .map((b) => (typeof b?.text === "string" ? b.text : ""))
      .join("");
    if (!raw.trim()) return null;
    // ALWAYS redact secrets before persisting/broadcasting agent text.
    return {
      kind: "thought",
      label: "Agent thought",
      text: redact(raw),
      ts,
    };
  }

  return null;
}
