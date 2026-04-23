// Builds the user.message text the agent receives at the start of a fix job.
//
// Kept in its own module so the prompt can be evolved without touching the
// route handler. When this changes meaningfully, update
// .agents/plans/sequential-soaring-plum.md §2.7 to keep the spec in sync.

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
  return `Bug report from user "${bugReport.reporter_name}" against ${app.github_repo_url}:

  Title: ${bugReport.title}
  Severity: ${bugReport.severity}

  ${bugReport.description}

The repository is checked out at /workspace/repo. The default branch is \`master\`
(NOT \`main\`) — jsdiff is an old project that never migrated.

Toolchain facts about this repo:
- packageManager is "yarn@4.12.0". Use Corepack + Yarn — NOT npm.
- The test files in test/ import from libesm/ (compiled output), NOT from src/.
  Any source edit must be followed by a rebuild before tests can observe it.
  \`yarn test\` runs \`yarn build && mocha\`, so it rebuilds libesm/ automatically.

Your task:
1. cd /workspace/repo
2. One-time setup:
     corepack enable
     yarn install --immutable
3. Run the test suite: \`yarn test\`. Note which tests fail and why.
4. Read the implicated source files. Identify the smallest fix.
5. Create a new branch off master named exactly: ${branch_name}
6. Apply the fix to src/.
7. Re-verify with \`yarn test\`. ALL tests must pass before proceeding.
   Fallback: if \`yarn test\` fails on issues clearly unrelated to your fix
   (e.g. nyc coverage thresholds, runtime.js / babel-register / require-of-ESM
   errors), fall back to:
     yarn build && npx mocha test/diff/word.js
   \`yarn build\` regenerates libesm/ from src/; bypassing \`--require ./runtime\`
   skips coverage but still runs the failing word-diff tests. Use the fallback
   ONLY if the upstream failure is clearly environmental, not your code.
8. Commit with a clear message: "fix: <one-line summary>"
9. Push the branch: \`git push -u origin ${branch_name}\`
10. Output "AGENT_DONE: ${branch_name}" on its own line.

If any step fails in a way you can't recover from, explain the error and stop.
DO NOT print or echo environment variables or token values at any point.`;
}
