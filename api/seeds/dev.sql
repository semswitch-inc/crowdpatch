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

INSERT OR REPLACE INTO apps (id, owner_user_id, github_repo_url, display_name) VALUES
  ('app_jsdiff_demo',
   'user_uploader_hassan',
   'https://github.com/semswitch-inc/jsdiff-demo',
   'jsdiff (demo canvas)');

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
  ('bug_002',
   'app_jsdiff_demo',
   'Bob (tester)',
   'patch parser drops the final hunk when no trailing newline',
   'parsePatch() silently truncates the last hunk if the input string does not end with a newline. Affects src/patch/parse.ts. Repro: feed any well-formed patch with no trailing newline; observe the missing hunk in the output.',
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
