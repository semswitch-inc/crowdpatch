// Builds the user.message text the agent receives at the start of a fix job.
//
// Day 3: this used to hardcode jsdiff-specific toolchain facts (master branch,
// yarn 4.12.0 with corepack, libesm/ rebuild rules, environmental fallback).
// Those facts now live in per-app seed data via migration 0003 — see
// `apps.default_branch / setup_commands / test_commands / agent_notes`. This
// template interpolates the structured fields and drops `agent_notes` in
// verbatim for repo idiosyncrasies that don't fit elsewhere.
//
// For repos without populated commands (e.g. a fresh self-host), falls back
// to npm install / npm test defaults so the prompt still parses.

import type { AppRow, BugReportRow } from "./db";

interface BuildAgentPromptParams {
  bugReport: BugReportRow;
  app: AppRow;
  branch_name: string;
}

export function buildAgentPrompt({
  bugReport,
  app,
  branch_name,
}: BuildAgentPromptParams): string {
  const setup = app.setup_commands ?? "npm install";
  const test = app.test_commands ?? "npm test";
  const notesBlock = app.agent_notes
    ? `\nRepo-specific notes:\n${app.agent_notes}\n`
    : "";

  return `Bug report from user "${bugReport.reporter_name}" against ${app.github_repo_url}:

  Title: ${bugReport.title}
  Severity: ${bugReport.severity}

  ${bugReport.description}

The repository is checked out at /workspace/repo. The default branch is \`${app.default_branch}\`.
${notesBlock}
Your task:
1. cd /workspace/repo
2. One-time setup, run:
     ${setup}
3. Run the test suite: \`${test}\`. Note which tests fail and why.
4. Read the implicated source files. Identify the smallest fix.
5. Create a new branch off ${app.default_branch} named exactly: ${branch_name}
6. Apply the fix.
7. Re-verify with \`${test}\`. ALL tests must pass before proceeding (subject to any environmental fallback noted above).
8. Commit with a clear message: "fix: <one-line summary>"
9. Push the branch: \`git push -u origin ${branch_name}\`
10. Output "AGENT_DONE: ${branch_name}" on its own line.

If any step fails in a way you can't recover from, explain the error and stop.
DO NOT print or echo environment variables or token values at any point.`;
}
