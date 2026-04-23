-- CrowdPatch v1 schema.
--
-- Conventions:
--   * All ids are TEXT (app-generated ULIDs/UUIDs).
--   * All timestamps are unix epoch seconds.
--   * CHECK constraints gate enum-ish string columns.
--   * FK columns reference parent tables. D1 enforces FKs by default
--     (equivalent to SQLite's PRAGMA foreign_keys = ON, applied per
--     transaction). Inserting a child row with a missing parent fails with
--     `FOREIGN KEY constraint failed: SQLITE_CONSTRAINT`. Use
--     `PRAGMA defer_foreign_keys = on` only when a migration's intermediate
--     state needs to temporarily bypass it (until end-of-transaction).
--
-- Migration discipline:
--   This file is LOCKED after first remote apply
--   (`npm run db:migrate:prod`). Once applied to production D1, do not edit
--   it. Future schema changes go in 0002_*.sql, 0003_*.sql, etc.

CREATE TABLE users (
  id              TEXT PRIMARY KEY,
  github_login    TEXT UNIQUE NOT NULL,
  display_name    TEXT,
  -- Fast cache of the credit_ledger sum for this user. Keep in sync with
  -- ledger via a single app-layer write path (debit/credit + ledger insert
  -- in one transaction). Reconcile via SELECT SUM(delta) in audit jobs.
  credits_balance INTEGER NOT NULL DEFAULT 0,
  created_at      INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE apps (
  id              TEXT PRIMARY KEY,
  owner_user_id   TEXT NOT NULL REFERENCES users(id),
  github_repo_url TEXT NOT NULL,
  display_name    TEXT NOT NULL,
  created_at      INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE bug_reports (
  id              TEXT PRIMARY KEY,
  app_id          TEXT NOT NULL REFERENCES apps(id),
  reporter_name   TEXT NOT NULL,
  title           TEXT NOT NULL,
  description     TEXT NOT NULL,
  severity        TEXT NOT NULL CHECK(severity IN ('low','medium','high')),
  status          TEXT NOT NULL DEFAULT 'open'
                    CHECK(status IN ('open','fixing','fixed','rejected')),
  created_at      INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX idx_bug_reports_app ON bug_reports(app_id, status);

CREATE TABLE fix_jobs (
  id                       TEXT PRIMARY KEY,
  app_id                   TEXT NOT NULL REFERENCES apps(id),

  -- Snapshot of the bug_report_ids included in the prompt at job creation.
  -- Frozen on insert for prompt reproducibility — even if a bug report is
  -- later edited or deleted, we can reconstruct what the agent was told.
  -- The authoritative many-to-many lives in fix_job_bug_reports below.
  bug_report_ids_json      TEXT NOT NULL,

  -- Anthropic Managed Agents identifiers (populated as the run progresses).
  anthropic_agent_id       TEXT,
  anthropic_environment_id TEXT,
  anthropic_session_id     TEXT,

  -- GitHub outcome (populated on success).
  branch_name              TEXT,
  commit_sha               TEXT,
  pr_url                   TEXT,

  status                   TEXT NOT NULL DEFAULT 'pending'
                             CHECK(status IN ('pending','running','succeeded','failed','cancelled')),

  -- Failure / success detail.
  error_message            TEXT,
  result_summary_json      TEXT,

  cost_credits             INTEGER NOT NULL DEFAULT 0,

  -- Lifecycle timestamps. App layer must set updated_at on every UPDATE
  -- (SQLite has no auto-update timestamp; we don't use a trigger to avoid
  -- recursion / surprise behavior).
  started_at               INTEGER,
  completed_at             INTEGER,
  created_at               INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at               INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX idx_fix_jobs_app ON fix_jobs(app_id, status);

-- Many-to-many between fix_jobs and bug_reports.
-- Source of truth for "which bugs is this job fixing" — use this for joins
-- and integrity. (fix_jobs.bug_report_ids_json remains as a frozen prompt
-- snapshot.)
CREATE TABLE fix_job_bug_reports (
  fix_job_id    TEXT NOT NULL REFERENCES fix_jobs(id),
  bug_report_id TEXT NOT NULL REFERENCES bug_reports(id),
  created_at    INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (fix_job_id, bug_report_id)
);
CREATE INDEX idx_fix_job_bug_reports_bug ON fix_job_bug_reports(bug_report_id);

CREATE TABLE credit_ledger (
  id                TEXT PRIMARY KEY,
  user_id           TEXT NOT NULL REFERENCES users(id),

  -- Signed delta. Negative = debit (spend), positive = credit (grant/refund).
  delta             INTEGER NOT NULL,

  -- Short machine-friendly tag describing why this entry exists
  -- (e.g., 'fix_job:debit', 'tester:bug_report_credit', 'seed:initial_grant',
  -- 'refund:fix_job_failed').
  reason            TEXT NOT NULL,

  -- Optional pointer to the entity that triggered this entry
  -- (fix_job id, bug_report id, etc.).
  related_entity_id TEXT,

  -- Idempotency key supplied by the caller. UNIQUE so retried writes (with
  -- the same key) collapse to a single ledger row. NULLs are allowed and
  -- not deduplicated — pre-existing rows without keys keep working.
  idempotency_key   TEXT UNIQUE,

  -- Snapshot of users.credits_balance AFTER this entry was applied.
  -- Lets audit jobs detect drift between users.credits_balance and
  -- the running sum of credit_ledger.delta.
  balance_after     INTEGER,

  -- Free-form JSON for additional context (job_id, pr_url, refund_reason, etc.).
  metadata_json     TEXT,

  created_at        INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX idx_credit_ledger_user ON credit_ledger(user_id, created_at DESC);
