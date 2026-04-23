-- CrowdPatch v1 schema.
-- All ids are TEXT (app-generated ULIDs/UUIDs); all timestamps are unix epoch seconds.
-- CHECK constraints gate enum-ish string columns.

CREATE TABLE users (
  id              TEXT PRIMARY KEY,
  github_login    TEXT UNIQUE NOT NULL,
  display_name    TEXT,
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
  id                    TEXT PRIMARY KEY,
  app_id                TEXT NOT NULL REFERENCES apps(id),
  bug_report_ids_json   TEXT NOT NULL,
  anthropic_session_id  TEXT,
  status                TEXT NOT NULL DEFAULT 'pending'
                          CHECK(status IN ('pending','running','succeeded','failed')),
  pr_url                TEXT,
  cost_credits          INTEGER NOT NULL DEFAULT 0,
  started_at            INTEGER,
  completed_at          INTEGER,
  created_at            INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX idx_fix_jobs_app ON fix_jobs(app_id, status);

CREATE TABLE credit_ledger (
  id                TEXT PRIMARY KEY,
  user_id           TEXT NOT NULL REFERENCES users(id),
  delta             INTEGER NOT NULL,
  reason            TEXT NOT NULL,
  related_entity_id TEXT,
  created_at        INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX idx_credit_ledger_user ON credit_ledger(user_id, created_at DESC);
