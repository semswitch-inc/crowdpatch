"use client";

import { useState } from "react";

import { withDemoHeaders } from "@/lib/api";
import { useDemoCode } from "@/lib/useDemoCode";
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

// BYO defaults are intentionally minimal — only `default_branch` is
// pre-filled (most repos default to `main`), everything else is blank so
// the user types their own toolchain. Switching to BYO mode resets all
// fields; switching back restores JSDIFF_DEFAULTS.
const BYO_DEFAULTS = {
  display_name: "",
  github_repo_url: "",
  default_branch: "main",
  setup_commands: "",
  test_commands: "",
  agent_notes: "",
};

type RunMode = "demo_pat" | "user_pat";

// Client-side regex mirrors api/src/lib/github.ts parseRepoUrl shape:
// rejects ?, #, whitespace anywhere in owner/repo. The server runs the
// authoritative parseRepoUrl check; this is just early UX feedback.
const REPO_URL_RE = /^https:\/\/github\.com\/[^/?#\s]+\/[^/?#\s]+?(\.git)?\/?$/;

const PASSWORD_MANAGER_IGNORE_PROPS = {
  "data-1p-ignore": "true",
  "data-bwignore": "true",
  "data-form-type": "other",
  "data-lpignore": "true",
} as const;

interface AppSubmissionFormProps {
  onConnected: (app: ConnectedApp) => void;
}

export default function AppSubmissionForm({
  onConnected,
}: AppSubmissionFormProps) {
  const { code: demoCode } = useDemoCode();
  const [runMode, setRunMode] = useState<RunMode>("demo_pat");
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
  const [isAdvancedOpen, setIsAdvancedOpen] = useState(false);

  // Switch all six fields to the chosen mode's defaults. Done as a single
  // batch so React renders one update; we don't try to preserve user input
  // across mode switches because the radio sits at the top of the form
  // (the user picks before typing).
  function switchRunMode(next: RunMode) {
    setRunMode(next);
    const d = next === "demo_pat" ? JSDIFF_DEFAULTS : BYO_DEFAULTS;
    setDisplayName(d.display_name);
    setRepoUrl(d.github_repo_url);
    setDefaultBranch(d.default_branch);
    setSetupCommands(d.setup_commands);
    setTestCommands(d.test_commands);
    setAgentNotes(d.agent_notes);
    setError(null);
  }

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
      const res = await fetch(
        `${apiBase}/api/apps`,
        withDemoHeaders(demoCode, {
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
        }),
      );
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
      // types/connected-app.ts comment block. auth_mode is purely
      // client-side state (the server never stores a PAT class on the
      // apps row), so we attach it from the radio selection here.
      onConnected({
        id: response.app_id,
        display_name: response.display_name,
        github_repo_url: response.github_repo_url,
        default_branch: response.default_branch,
        auth_mode: runMode,
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
      aria-labelledby="app_submission_title"
      autoComplete="off"
      data-form-type="other"
      className="cp-card pad-md flex w-full flex-col gap-5"
    >
      <div className="flex flex-col gap-1">
        <h2 id="app_submission_title" className="cp-h3">
          Choose the app Claude will patch.
        </h2>
        <p className="cp-small">
          For the recording, use the pre-filled jsdiff repo. It has a real bug,
          real tests, and opens a real pull request.
        </p>
      </div>

      <fieldset className="cp-field" aria-describedby="run_mode_hint">
        <legend className="cp-field-label">Patch target</legend>
        <div className="flex flex-col gap-2 rounded-md border border-ink-700 bg-ink-950/40 p-3">
          <label className="flex cursor-pointer items-start gap-2 text-sm text-ink-100">
            <input
              type="radio"
              name="run_mode"
              value="demo_pat"
              checked={runMode === "demo_pat"}
              onChange={() => switchRunMode("demo_pat")}
              className="mt-1"
            />
            <span className="flex flex-col">
              <span className="font-600">
                Use the demo repo{" "}
                <span className="font-mono text-xs text-lime-300">
                  (recommended)
                </span>
              </span>
              <span className="cp-small">
                Best for the video: real repo, real planted bug, no GitHub token
                needed.
              </span>
            </span>
          </label>
          <label className="flex cursor-pointer items-start gap-2 text-sm text-ink-100">
            <input
              type="radio"
              name="run_mode"
              value="user_pat"
              checked={runMode === "user_pat"}
              onChange={() => switchRunMode("user_pat")}
              className="mt-1"
            />
            <span className="flex flex-col">
              <span className="font-600">Try your own repo</span>
              <span className="cp-small">
                Experimental path. Paste a GitHub token before the run so
                CrowdPatch can clone, patch, and open a PR.
              </span>
            </span>
          </label>
        </div>
        {runMode === "user_pat" && (
          <div
            id="run_mode_hint"
            className="cp-card tint-warning bar-warning pad-md text-sm text-orange-100"
          >
            <strong className="font-600 text-orange-50">
              For custom repos:
            </strong>{" "}
            use a fine-grained GitHub token for one repo only. It needs{" "}
            <span className="font-mono text-xs">Contents</span> and{" "}
            <span className="font-mono text-xs">Pull requests</span> access.
            CrowdPatch never stores it.
          </div>
        )}
      </fieldset>

      <Field
        label="Display name"
        htmlFor="display_name"
        error={fieldErrors.display_name}
      >
        <input
          {...PASSWORD_MANAGER_IGNORE_PROPS}
          id="display_name"
          name="display_name"
          type="text"
          autoComplete="organization"
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
        hint={
          runMode === "user_pat"
            ? "Use a repo you control. You will paste a temporary GitHub token before Claude starts."
            : "Leave this as-is for the reliable jsdiff demo."
        }
      >
        <input
          {...PASSWORD_MANAGER_IGNORE_PROPS}
          id="github_repo_url"
          name="github_repo_url"
          type="url"
          autoComplete="url"
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
        hint="Claude opens the pull request against this branch."
      >
        <input
          {...PASSWORD_MANAGER_IGNORE_PROPS}
          id="default_branch"
          name="default_branch"
          type="text"
          autoComplete="off"
          required
          maxLength={80}
          value={defaultBranch}
          onChange={(e) => setDefaultBranch(e.target.value)}
          className="cp-input mono"
        />
      </Field>

      <div className="rounded-md border border-ink-700 bg-ink-950/40 overflow-hidden">
        <button
          type="button"
          onClick={() => setIsAdvancedOpen(!isAdvancedOpen)}
          className="flex w-full cursor-pointer list-none items-center justify-between px-3 py-2 font-mono text-xs font-600 uppercase tracking-[0.12em] text-ink-300 hover:text-orange-300"
        >
          <span>Advanced setup for Claude</span>
          <span
            className={`text-ink-500 transition-transform ${isAdvancedOpen ? "rotate-90" : ""}`}
          >
            ›
          </span>
        </button>
        <div
          className="grid transition-all duration-300 ease-in-out"
          style={{ gridTemplateRows: isAdvancedOpen ? "1fr" : "0fr" }}
        >
          <div className="overflow-hidden">
            <div className="flex flex-col gap-4 border-t border-ink-700 p-4">
              <Field label="Setup command" htmlFor="setup_commands">
                <input
                  {...PASSWORD_MANAGER_IGNORE_PROPS}
                  id="setup_commands"
                  name="setup_commands"
                  type="text"
                  autoComplete="off"
                  maxLength={500}
                  value={setupCommands}
                  onChange={(e) => setSetupCommands(e.target.value)}
                  className="cp-input mono"
                />
              </Field>

              <Field label="Test command" htmlFor="test_commands">
                <input
                  {...PASSWORD_MANAGER_IGNORE_PROPS}
                  id="test_commands"
                  name="test_commands"
                  type="text"
                  autoComplete="off"
                  maxLength={500}
                  value={testCommands}
                  onChange={(e) => setTestCommands(e.target.value)}
                  className="cp-input mono"
                />
              </Field>

              <Field
                label="Project notes / agent notes"
                htmlFor="agent_notes"
                hint="Extra repo instructions Claude should read before patching."
              >
                <textarea
                  {...PASSWORD_MANAGER_IGNORE_PROPS}
                  id="agent_notes"
                  name="agent_notes"
                  autoComplete="off"
                  maxLength={4000}
                  rows={6}
                  value={agentNotes}
                  onChange={(e) => setAgentNotes(e.target.value)}
                  className="cp-textarea mono"
                />
                <span className="cp-field-count">{agentNotes.length}/4000</span>
              </Field>
            </div>
          </div>
        </div>
      </div>

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
