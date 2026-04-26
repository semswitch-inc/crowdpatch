"use client";

import { useState } from "react";

import { withDemoHeaders } from "@/lib/api";
import { useDemoCode } from "@/lib/useDemoCode";
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
  const { code: demoCode } = useDemoCode();
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
      const res = await fetch(
        `${apiBase}/api/bug-reports`,
        withDemoHeaders(demoCode, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: title.trim(),
            description: description.trim(),
            reporter_name: reporterName.trim(),
            severity,
            app_id: appId,
          }),
        }),
      );
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
      className="cp-card pad-md flex w-full flex-col gap-5"
    >
      <div className="flex flex-col gap-1">
        <h2 className="cp-h3">Describe the bug for Claude.</h2>
        <p className="cp-small">
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
          className="cp-input"
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
          className="cp-input"
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
          className="cp-textarea mono"
        />
        <span className="cp-field-count">{description.length}/2000</span>
      </Field>

      <Field label="Severity" htmlFor="severity">
        <select
          id="severity"
          value={severity}
          onChange={(e) =>
            setSeverity(e.target.value as "low" | "medium" | "high")
          }
          className="cp-select"
        >
          <option value="low">low</option>
          <option value="medium">medium</option>
          <option value="high">high</option>
        </select>
      </Field>

      {error && (
        <div className="cp-card tint-danger bar-danger pad-md text-sm text-red-200">
          <strong className="font-600 text-red-100">
            Couldn&apos;t save report.
          </strong>{" "}
          <span className="font-mono text-xs">{error}</span>
        </div>
      )}

      <button
        type="submit"
        disabled={submitting || formInvalid}
        className="cp-btn cp-btn-primary self-start"
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
    <div className="cp-field">
      <label htmlFor={htmlFor} className="cp-field-label">
        {label}
      </label>
      {children}
      {hint && !error && <span className="cp-field-hint">{hint}</span>}
      {error && <span className="cp-field-error">{error}</span>}
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
