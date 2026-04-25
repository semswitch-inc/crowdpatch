"use client";

import { useState } from "react";

import type { SubmittedBug } from "@/types/submitted-bug";

// Mirrors api/seeds/dev.sql bug_001 byte-for-byte. Submitting unedited
// produces a prompt identical to the seeded ?bug=bug_001 path → guaranteed
// PR. Editing any field flows the new text through to the agent prompt and
// the GitHub PR (title + Submitted-report block).
const BUG_001_DEFAULTS = {
  reporter_name: "Alice (tester)",
  title:
    "word-diff treats whitespace-only differences between tokens as real changes",
  description:
    "diffWords() returns <del>/<ins> change objects when two strings differ only in the whitespace between word tokens (e.g. multiple spaces vs a newline+tab). Affects src/diff/word.ts. Repro: diffWords('New    Value', 'New \\n \\t Value') returns add+remove changes; expected output is a single unchanged change object. Failing mocha test: \"should ignore whitespace changes between tokens that aren't added or deleted\" in test/diff/word.js, which asserts convertChangesToXML(diffResult) equals 'New \\n \\t Value'. Other failing tests in the same file include \"should ignore whitespace\".",
  severity: "medium" as const,
};

type FieldErrors = Partial<Record<keyof typeof BUG_001_DEFAULTS, string>>;

interface BugReportFormProps {
  // The app the bug is being filed against. Required (non-nullable) so the
  // form cannot accidentally fall back to the server's default app_id —
  // every bug submitted through this form must travel with the app the user
  // just connected in Step 1.
  appId: string;
  onSubmitted: (bug: SubmittedBug) => void;
}

export default function BugReportForm({
  appId,
  onSubmitted,
}: BugReportFormProps) {
  const [reporterName, setReporterName] = useState(
    BUG_001_DEFAULTS.reporter_name,
  );
  const [title, setTitle] = useState(BUG_001_DEFAULTS.title);
  const [description, setDescription] = useState(BUG_001_DEFAULTS.description);
  const [severity, setSeverity] = useState<"low" | "medium" | "high">(
    BUG_001_DEFAULTS.severity,
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fieldErrors: FieldErrors = {};
  if (!reporterName.trim()) fieldErrors.reporter_name = "Required.";
  if (!title.trim()) fieldErrors.title = "Required.";
  if (!description.trim()) fieldErrors.description = "Required.";
  const formInvalid = Object.keys(fieldErrors).length > 0;

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitting || formInvalid) return;

    const apiBase = process.env.NEXT_PUBLIC_API_BASE;
    if (!apiBase) {
      setError("NEXT_PUBLIC_API_BASE not set in .env.local");
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`${apiBase}/api/bug-reports`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim(),
          reporter_name: reporterName.trim(),
          severity,
          app_id: appId,
        }),
      });
      if (!res.ok) {
        throw new Error(await extractErrorDetail(res));
      }
      const { bug_report_id } = (await res.json()) as {
        bug_report_id: string;
        app_id: string;
      };
      onSubmitted({
        id: bug_report_id,
        title: title.trim(),
        description: description.trim(),
        reporter_name: reporterName.trim(),
        severity,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex w-full flex-col gap-5 rounded-xl border border-ink-700 bg-ink-900/40 p-6"
    >
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-600 text-ink-50">
          Describe the bug for Claude.
        </h2>
        <p className="text-sm text-ink-300">
          Start with the demo bug, or edit it before patching. Your text lands
          in the Managed Agent&apos;s prompt and the GitHub PR.
        </p>
      </div>

      <Field
        label="Reporter name"
        htmlFor="reporter_name"
        error={fieldErrors.reporter_name}
      >
        <input
          id="reporter_name"
          type="text"
          required
          maxLength={80}
          value={reporterName}
          onChange={(e) => setReporterName(e.target.value)}
          className="w-full rounded-md border border-ink-700 bg-ink-950 px-3 py-2 text-sm text-ink-50 placeholder:text-ink-400 focus-visible:border-orange-500 focus-visible:outline-none"
        />
      </Field>

      <Field label="Title" htmlFor="title" error={fieldErrors.title}>
        <input
          id="title"
          type="text"
          required
          maxLength={120}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="w-full rounded-md border border-ink-700 bg-ink-950 px-3 py-2 text-sm text-ink-50 placeholder:text-ink-400 focus-visible:border-orange-500 focus-visible:outline-none"
        />
      </Field>

      <Field
        label="Description"
        htmlFor="description"
        error={fieldErrors.description}
        hint="What's broken, where, and how to reproduce it. Up to 2000 chars."
      >
        <textarea
          id="description"
          required
          maxLength={2000}
          rows={8}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="w-full rounded-md border border-ink-700 bg-ink-950 px-3 py-2 font-mono text-xs text-ink-50 placeholder:text-ink-400 focus-visible:border-orange-500 focus-visible:outline-none"
        />
        <span className="self-end text-xs tabular-nums text-ink-400">
          {description.length}/2000
        </span>
      </Field>

      <Field label="Severity" htmlFor="severity">
        <select
          id="severity"
          value={severity}
          onChange={(e) =>
            setSeverity(e.target.value as "low" | "medium" | "high")
          }
          className="w-full rounded-md border border-ink-700 bg-ink-950 px-3 py-2 text-sm text-ink-50 focus-visible:border-orange-500 focus-visible:outline-none"
        >
          <option value="low">low</option>
          <option value="medium">medium</option>
          <option value="high">high</option>
        </select>
      </Field>

      {error && (
        <div className="rounded-md border border-red-500/40 bg-red-500/[0.10] px-3 py-2 text-sm text-red-200">
          <strong className="font-600 text-red-100">
            Couldn&apos;t save report.
          </strong>{" "}
          <span className="font-mono text-xs">{error}</span>
        </div>
      )}

      <button
        type="submit"
        disabled={submitting || formInvalid}
        className="self-start inline-flex items-center gap-2 rounded-lg bg-orange-500 px-5 py-2.5 text-sm font-600 text-ink-black shadow-[0_0_0_1px_rgba(255,124,43,.4),0_8px_24px_-8px_rgba(255,92,10,.6)] transition-all hover:bg-orange-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-400 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-orange-500"
      >
        {submitting ? "Saving…" : "Save bug report →"}
      </button>
    </form>
  );
}

interface FieldProps {
  label: string;
  htmlFor: string;
  error?: string;
  hint?: string;
  children: React.ReactNode;
}

function Field({ label, htmlFor, error, hint, children }: FieldProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <label
        htmlFor={htmlFor}
        className="text-xs font-600 uppercase tracking-[0.12em] text-ink-300"
      >
        {label}
      </label>
      {children}
      {hint && !error && <span className="text-xs text-ink-400">{hint}</span>}
      {error && <span className="text-xs text-red-300">{error}</span>}
    </div>
  );
}

async function extractErrorDetail(res: Response): Promise<string> {
  try {
    const body: unknown = await res.json();
    // Hono+Zod validator default shape: { success: false, error: { ... } }
    if (
      typeof body === "object" &&
      body !== null &&
      "success" in body &&
      (body as { success: unknown }).success === false &&
      "error" in body
    ) {
      const inner = (body as { error: unknown }).error;
      if (typeof inner === "object" && inner !== null && "message" in inner) {
        const msg = (inner as { message: unknown }).message;
        if (typeof msg === "string") return msg;
      }
      return "validation failed";
    }
    // Our 422 / 500 shape: { error: "...", ... }
    if (
      typeof body === "object" &&
      body !== null &&
      "error" in body &&
      typeof (body as { error: unknown }).error === "string"
    ) {
      return (body as { error: string }).error;
    }
  } catch {
    // non-JSON response
  }
  return `HTTP ${res.status}`;
}
