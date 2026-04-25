"use client";

import { useState } from "react";

import type { ConnectedApp } from "@/types/connected-app";

// Mirrors api/seeds/dev.sql lines 37-55 byte-for-byte. A no-edit submit
// produces an apps row functionally identical to the seeded
// `app_jsdiff_demo` and reaches the same reliable PR pattern. Editing any
// field flows the new toolchain through to the agent prompt and PR body.
const JSDIFF_DEFAULTS = {
  display_name: "jsdiff (demo canvas)",
  github_repo_url: "https://github.com/semswitch-inc/jsdiff-demo",
  default_branch: "master",
  setup_commands: "corepack enable && yarn install --immutable",
  test_commands: "yarn test",
  agent_notes: `packageManager is yarn@4.12.0 — use Corepack + Yarn, NOT npm.

Tests in test/ import from libesm/ (compiled output), NOT from src/. Any source edit must be followed by a rebuild before tests can observe it. \`yarn test\` runs \`yarn build && mocha\`, so it auto-rebuilds.

Fallback if \`yarn test\` fails on issues clearly unrelated to your fix (e.g. nyc coverage thresholds, runtime.js / babel-register / require-of-ESM errors), fall back to:
  yarn build && npx mocha test/diff/word.js

\`yarn build\` regenerates libesm/ from src/; bypassing \`--require ./runtime\` skips coverage but still runs the failing tests. Use the fallback ONLY when the upstream failure is clearly environmental, not your code.`,
};

// Client-side regex mirrors api/src/lib/github.ts parseRepoUrl shape:
// rejects ?, #, whitespace anywhere in owner/repo. The server runs the
// authoritative parseRepoUrl check; this is just early UX feedback.
const REPO_URL_RE = /^https:\/\/github\.com\/[^/?#\s]+\/[^/?#\s]+?(\.git)?\/?$/;

interface AppSubmissionFormProps {
  onConnected: (app: ConnectedApp) => void;
}

export default function AppSubmissionForm({
  onConnected,
}: AppSubmissionFormProps) {
  const [displayName, setDisplayName] = useState(JSDIFF_DEFAULTS.display_name);
  const [repoUrl, setRepoUrl] = useState(JSDIFF_DEFAULTS.github_repo_url);
  const [defaultBranch, setDefaultBranch] = useState(
    JSDIFF_DEFAULTS.default_branch,
  );
  const [setupCommands, setSetupCommands] = useState(
    JSDIFF_DEFAULTS.setup_commands,
  );
  const [testCommands, setTestCommands] = useState(
    JSDIFF_DEFAULTS.test_commands,
  );
  const [agentNotes, setAgentNotes] = useState(JSDIFF_DEFAULTS.agent_notes);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fieldErrors: Partial<
    Record<"display_name" | "github_repo_url" | "default_branch", string>
  > = {};
  if (!displayName.trim()) fieldErrors.display_name = "Required.";
  if (!repoUrl.trim()) fieldErrors.github_repo_url = "Required.";
  else if (!REPO_URL_RE.test(repoUrl.trim())) {
    fieldErrors.github_repo_url =
      "Must be a github.com repo URL (https://github.com/owner/repo).";
  }
  if (!defaultBranch.trim()) fieldErrors.default_branch = "Required.";
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
      const res = await fetch(`${apiBase}/api/apps`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          display_name: displayName.trim(),
          github_repo_url: repoUrl.trim(),
          default_branch: defaultBranch.trim(),
          setup_commands: setupCommands,
          test_commands: testCommands,
          agent_notes: agentNotes,
        }),
      });
      if (!res.ok) {
        throw new Error(await extractErrorDetail(res));
      }
      const response = (await res.json()) as {
        app_id: string;
        display_name: string;
        github_repo_url: string;
        default_branch: string;
      };
      // Explicit field rename: server `app_id` → client `id`. See
      // types/connected-app.ts comment block.
      onConnected({
        id: response.app_id,
        display_name: response.display_name,
        github_repo_url: response.github_repo_url,
        default_branch: response.default_branch,
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
        <h2 className="cp-h3">Connect an app to CrowdPatch.</h2>
        <p className="cp-small">
          Start with the pre-filled jsdiff demo, or wire in your own repo. We
          save this so a tester can file bugs against it next.
        </p>
      </div>

      <Field
        label="Display name"
        htmlFor="display_name"
        error={fieldErrors.display_name}
      >
        <input
          id="display_name"
          type="text"
          required
          maxLength={80}
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          className="cp-input"
        />
      </Field>

      <Field
        label="GitHub repo URL"
        htmlFor="github_repo_url"
        error={fieldErrors.github_repo_url}
        hint="Custom repos are experimental. The reliable demo uses the pre-filled jsdiff repo. To open a PR on another repo, the demo bot must have write access."
      >
        <input
          id="github_repo_url"
          type="url"
          required
          maxLength={255}
          value={repoUrl}
          onChange={(e) => setRepoUrl(e.target.value)}
          className="cp-input mono"
        />
      </Field>

      <Field
        label="Default branch"
        htmlFor="default_branch"
        error={fieldErrors.default_branch}
        hint="Used as the PR base branch."
      >
        <input
          id="default_branch"
          type="text"
          required
          maxLength={80}
          value={defaultBranch}
          onChange={(e) => setDefaultBranch(e.target.value)}
          className="cp-input mono"
        />
      </Field>

      <details className="group rounded-md border border-ink-700 bg-ink-950/40">
        <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2 font-mono text-xs font-600 uppercase tracking-[0.12em] text-ink-300 hover:text-orange-300">
          <span>Advanced toolchain (pre-filled)</span>
          <span className="text-ink-500 transition-transform group-open:rotate-90">
            ›
          </span>
        </summary>
        <div className="flex flex-col gap-4 border-t border-ink-700 p-4">
          <Field label="Setup command" htmlFor="setup_commands">
            <input
              id="setup_commands"
              type="text"
              maxLength={500}
              value={setupCommands}
              onChange={(e) => setSetupCommands(e.target.value)}
              className="cp-input mono"
            />
          </Field>

          <Field label="Test command" htmlFor="test_commands">
            <input
              id="test_commands"
              type="text"
              maxLength={500}
              value={testCommands}
              onChange={(e) => setTestCommands(e.target.value)}
              className="cp-input mono"
            />
          </Field>

          <Field
            label="Project notes / agent notes"
            htmlFor="agent_notes"
            hint="Repo idiosyncrasies that don't fit the structured commands. Inlined verbatim into the agent prompt."
          >
            <textarea
              id="agent_notes"
              maxLength={4000}
              rows={6}
              value={agentNotes}
              onChange={(e) => setAgentNotes(e.target.value)}
              className="cp-textarea mono"
            />
            <span className="cp-field-count">{agentNotes.length}/4000</span>
          </Field>
        </div>
      </details>

      {error && (
        <div className="cp-card tint-danger bar-danger pad-md text-sm text-red-200">
          <strong className="font-600 text-red-100">
            Couldn&apos;t connect app.
          </strong>{" "}
          <span className="font-mono text-xs">{error}</span>
        </div>
      )}

      <button
        type="submit"
        disabled={submitting || formInvalid}
        className="cp-btn cp-btn-primary self-start"
      >
        {submitting ? "Connecting…" : "Connect app →"}
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
