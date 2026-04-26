-- CrowdPatch dev seed.
--
-- Populates a known set of users, the demo app, planted bug reports, and
-- the matching initial credit_ledger grants. Safe to re-run: every INSERT
-- uses OR REPLACE keyed on the seeded id, so a second run resets to the
-- snapshot below (without touching unrelated rows like in-flight fix_jobs
-- or runtime credit_ledger entries).
--
-- Run via:
--   npm run db:seed:local   (against the .wrangler local D1)
--   npm run db:seed:prod    (against the remote production D1)

-- ────────────────────────────────────────────────────────────────────────
-- Users
-- ────────────────────────────────────────────────────────────────────────

-- Demo uploader: spends credits to dispatch fix jobs.
INSERT OR REPLACE INTO users (id, github_login, display_name, credits_balance) VALUES
  ('user_uploader_hassan', 'hassan-uploader', 'Hassan (uploader demo)', 100);

-- Demo testers: file bug reports, earn credits.
INSERT OR REPLACE INTO users (id, github_login, display_name, credits_balance) VALUES
  ('user_tester_alice', 'tester-alice', 'Alice (tester)', 25),
  ('user_tester_bob',   'tester-bob',   'Bob (tester)',   15),
  ('user_tester_carol', 'tester-carol', 'Carol (tester)', 30),
  ('user_tester_diego', 'tester-diego', 'Diego (tester)', 10);

-- ────────────────────────────────────────────────────────────────────────
-- Apps
-- ────────────────────────────────────────────────────────────────────────

-- Per-repo toolchain context populated for app_jsdiff_demo (Day 3 — see
-- migration 0003). default_branch is also used as the PR base in
-- durable_objects/agentSession.ts. agent_notes carries the load-bearing
-- jsdiff-specific facts (compiled libesm output, mandatory rebuild,
-- environmental fallback) that don't fit the structured commands fields.
INSERT OR REPLACE INTO apps (
  id, owner_user_id, github_repo_url, display_name,
  default_branch, setup_commands, test_commands, agent_notes
) VALUES
  ('app_jsdiff_demo',
   'user_uploader_hassan',
   'https://github.com/semswitch-inc/jsdiff-demo',
   'jsdiff (demo canvas)',
   'master',
   'git config --global commit.gpgsign false || true && corepack enable && yarn install --immutable',
   'yarn test',
   'packageManager is yarn@4.12.0 — use Corepack + Yarn, NOT npm.

Tests in test/ import from libesm/ (compiled output), NOT from src/. Any source edit must be followed by a rebuild before tests can observe it. `yarn test` runs `yarn build && mocha`, so it auto-rebuilds.

Fallback if `yarn test` fails on issues clearly unrelated to your fix (e.g. nyc coverage thresholds, runtime.js / babel-register / require-of-ESM errors), fall back to:
  yarn build && npx mocha test/diff/word.js

`yarn build` regenerates libesm/ from src/; bypassing `--require ./runtime` skips coverage but still runs the failing tests. Use the fallback ONLY when the upstream failure is clearly environmental, not your code.

If `git commit` fails with `MCP server request failed ... 127.0.0.1:40739` (or any reference to `environment-runner code-sign`), the sandbox''s commit-signing service is down. Retry the commit once with the per-command bypass: `git -c commit.gpgsign=false commit -m "<your message>"`. If it still fails with the same signing error, this is an Anthropic sandbox infra outage in this instance — report the blocker, output `AGENT_DONE` is not appropriate, and stop. The user will retry on a fresh sandbox.');

-- ────────────────────────────────────────────────────────────────────────
-- Bug reports — tied to the planted bugs in jsdiff-demo
-- (see .agents/plans/scaffold-plan.md §4 Day 1/Day 3 plant steps).
-- ────────────────────────────────────────────────────────────────────────

INSERT OR REPLACE INTO bug_reports (id, app_id, reporter_name, title, description, severity, status) VALUES
  ('bug_001',
   'app_jsdiff_demo',
   'Alice (tester)',
   'word-diff treats whitespace-only differences between tokens as real changes',
   'diffWords() returns <del>/<ins> change objects when two strings differ only in the whitespace between word tokens (e.g. multiple spaces vs a newline+tab). Affects src/diff/word.ts. Repro: diffWords(''New    Value'', ''New \n \t Value'') returns add+remove changes; expected output is a single unchanged change object. Failing mocha test: "should ignore whitespace changes between tokens that aren''t added or deleted" in test/diff/word.js, which asserts convertChangesToXML(diffResult) equals ''New \n \t Value''. Other failing tests in the same file include "should ignore whitespace".',
   'medium',
   'open'),
  -- bug_002 is a template / example row — the bug is described but not
  -- planted in semswitch-inc/jsdiff-demo. The agent run for ?bug=bug_002
  -- demonstrates the URL-routing flow but won't produce a real PR. To
  -- demo a working second bug, plant a real defect and update this row.
  ('bug_002',
   'app_jsdiff_demo',
   'Bob (tester)',
   '[EXAMPLE — not planted] patch parser would drop the final hunk when no trailing newline',
   'EXAMPLE bug template. Describes a hypothetical regression in parsePatch() where the last hunk is dropped if the input has no trailing newline. The bug is NOT actually planted in semswitch-inc/jsdiff-demo (src/patch/parse.ts matches upstream). Use this row to verify the ?bug=<id> URL-routing flow, OR replace it with a real bug for a fuller demo.',
   'high',
   'open');

-- ────────────────────────────────────────────────────────────────────────
-- Credit ledger — initial grants matching the credits_balance values above.
-- Idempotency keys make these safe to re-run.
-- ────────────────────────────────────────────────────────────────────────

INSERT OR REPLACE INTO credit_ledger
  (id, user_id, delta, reason, idempotency_key, balance_after, metadata_json)
VALUES
  ('ledger_seed_uploader', 'user_uploader_hassan', 100, 'seed:initial_grant',
   'seed:user_uploader_hassan:initial', 100, '{"source":"dev_seed"}'),
  ('ledger_seed_alice',    'user_tester_alice',     25, 'seed:initial_grant',
   'seed:user_tester_alice:initial',    25, '{"source":"dev_seed"}'),
  ('ledger_seed_bob',      'user_tester_bob',       15, 'seed:initial_grant',
   'seed:user_tester_bob:initial',      15, '{"source":"dev_seed"}'),
  ('ledger_seed_carol',    'user_tester_carol',     30, 'seed:initial_grant',
   'seed:user_tester_carol:initial',    30, '{"source":"dev_seed"}'),
  ('ledger_seed_diego',    'user_tester_diego',     10, 'seed:initial_grant',
   'seed:user_tester_diego:initial',    10, '{"source":"dev_seed"}');
