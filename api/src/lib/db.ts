// D1 helpers + row types. Keep all SQL in this file so the route handlers
// stay declarative.
//
// FK enforcement: D1 enforces foreign keys by default (PRAGMA foreign_keys = ON
// equivalent), so a child INSERT against a missing parent fails with
// `FOREIGN KEY constraint failed: SQLITE_CONSTRAINT`. Caller can let the
// throw bubble — callers in route handlers should treat it as a 4xx.

export interface BugReportRow {
  id: string;
  app_id: string;
  reporter_name: string;
  title: string;
  description: string;
  severity: "low" | "medium" | "high";
  status: "open" | "fixing" | "fixed" | "rejected";
  created_at: number;
}

export interface AppRow {
  id: string;
  owner_user_id: string;
  github_repo_url: string;
  display_name: string;
  // Per-repo agent toolchain context (Day 3 — see migration 0003).
  // default_branch: NOT NULL DEFAULT 'main'; jsdiff-demo uses 'master'.
  // setup_commands / test_commands / agent_notes: nullable; agent prompt
  // falls back to 'npm install' / 'npm test' if the structured commands
  // are null, and only includes the agent_notes block when populated.
  default_branch: string;
  setup_commands: string | null;
  test_commands: string | null;
  agent_notes: string | null;
  created_at: number;
}

export interface FixJobInsert {
  id: string;
  app_id: string;
  bug_report_ids_json: string;
  branch_name: string;
  status: "pending" | "running" | "succeeded" | "failed" | "cancelled";
  started_at: number | null;
}

// Patchable subset of fix_jobs columns. Only fields explicitly listed here
// can be updated — keeps the dynamic SQL builder safe from injection
// regardless of caller input.
export interface FixJobUpdate {
  status?: "running" | "succeeded" | "failed" | "cancelled";
  anthropic_session_id?: string | null;
  branch_name?: string | null;
  commit_sha?: string | null;
  pr_url?: string | null;
  error_message?: string | null;
  result_summary_json?: string | null;
  cost_credits?: number;
  ended_reason?: string | null;
  completed_at?: number | null;
}

const ALLOWED_UPDATE_KEYS: ReadonlySet<string> = new Set<keyof FixJobUpdate>([
  "status",
  "anthropic_session_id",
  "branch_name",
  "commit_sha",
  "pr_url",
  "error_message",
  "result_summary_json",
  "cost_credits",
  "ended_reason",
  "completed_at",
]);

export async function getBugReport(
  db: D1Database,
  id: string,
): Promise<BugReportRow | null> {
  const row = await db
    .prepare("SELECT * FROM bug_reports WHERE id = ?")
    .bind(id)
    .first<BugReportRow>();
  return row ?? null;
}

export async function getApp(
  db: D1Database,
  id: string,
): Promise<AppRow | null> {
  const row = await db
    .prepare(
      `SELECT id, owner_user_id, github_repo_url, display_name,
              default_branch, setup_commands, test_commands, agent_notes,
              created_at
         FROM apps WHERE id = ?`,
    )
    .bind(id)
    .first<AppRow>();
  return row ?? null;
}

export async function createFixJob(
  db: D1Database,
  job: FixJobInsert,
  bugReportIds: readonly string[],
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);

  // D1 batch — atomic per-statement, but not a single transaction. Acceptable
  // here because the join row INSERTs are idempotent against the unique pkey.
  const stmts = [
    db
      .prepare(
        `INSERT INTO fix_jobs
           (id, app_id, bug_report_ids_json, branch_name, status,
            started_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        job.id,
        job.app_id,
        job.bug_report_ids_json,
        job.branch_name,
        job.status,
        job.started_at,
        now,
        now,
      ),
    ...bugReportIds.map((bugReportId) =>
      db
        .prepare(
          `INSERT INTO fix_job_bug_reports (fix_job_id, bug_report_id, created_at)
           VALUES (?, ?, ?)`,
        )
        .bind(job.id, bugReportId, now),
    ),
  ];

  await db.batch(stmts);
}

export async function updateFixJob(
  db: D1Database,
  id: string,
  patch: FixJobUpdate,
): Promise<void> {
  const sets: string[] = [];
  const binds: Array<string | number | null> = [];

  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    if (!ALLOWED_UPDATE_KEYS.has(key)) continue; // defense-in-depth
    sets.push(`${key} = ?`);
    binds.push(value as string | number | null);
  }

  if (sets.length === 0) return;

  // Always bump updated_at on every UPDATE.
  sets.push("updated_at = ?");
  binds.push(Math.floor(Date.now() / 1000));
  binds.push(id);

  await db
    .prepare(`UPDATE fix_jobs SET ${sets.join(", ")} WHERE id = ?`)
    .bind(...binds)
    .run();
}
