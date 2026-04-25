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

export interface BugReportInsert {
  id: string;
  app_id: string;
  reporter_name: string;
  title: string;
  description: string;
  severity: "low" | "medium" | "high";
}

export interface AppInsert {
  id: string;
  owner_user_id: string;
  github_repo_url: string;
  display_name: string;
  default_branch: string;
  // Optional toolchain columns are typed `string | null` (NOT `| undefined`).
  // The route handler normalizes missing/blank inputs to null before calling
  // createApp so agentPrompt.ts:26-28 fallbacks (npm install / npm test / no
  // notes block) keep working — empty strings would defeat them.
  setup_commands: string | null;
  test_commands: string | null;
  agent_notes: string | null;
}

export interface FixJobInsert {
  id: string;
  app_id: string;
  bug_report_ids_json: string;
  branch_name: string;
  status: "pending" | "running" | "succeeded" | "failed" | "cancelled";
  started_at: number | null;
  // Which prompt variant ran (A/B/C/D). NULL = legacy unspecified (uses
  // ANTHROPIC_AGENT_ID env var, not one of the variant secrets). Persisted
  // at INSERT time because the variant selection is a property of the
  // request, not something the agent can change mid-run.
  agent_variant: string | null;
  // Stamped at insert so refunds read the per-job cost from the row instead
  // of a hardcoded constant — keeps refund correctness if pricing ever
  // diverges per-app or per-variant.
  cost_credits: number;
}

export interface CreditLedgerRow {
  id: string;
  user_id: string;
  delta: number;
  reason: string;
  related_entity_id: string | null;
  idempotency_key: string | null;
  balance_after: number | null;
  metadata_json: string | null;
  created_at: number;
}

export interface CreditLedgerInsert {
  id: string;
  user_id: string;
  delta: number;
  reason: string;
  related_entity_id: string | null;
  idempotency_key: string;
  metadata_json: string | null;
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
  // Captured from the FIRST span.model_request_end event. See migration 0004
  // for why first-only (deterministic platform-prompt-drift fingerprint).
  first_cache_creation_input_tokens?: number | null;
  first_cache_read_input_tokens?: number | null;
  first_input_tokens?: number | null;
  first_output_tokens?: number | null;
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
  "first_cache_creation_input_tokens",
  "first_cache_read_input_tokens",
  "first_input_tokens",
  "first_output_tokens",
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

export async function createApp(db: D1Database, row: AppInsert): Promise<void> {
  // created_at defaults to unixepoch() via the table schema (migration 0001).
  // FK on owner_user_id raises SQLITE_CONSTRAINT if the parent user doesn't
  // exist — the route hardcodes 'user_uploader_hassan' (verified by Gate A
  // pre-flight on the seeded users row), so a violation here means the seed
  // was lost and the deploy should halt.
  await db
    .prepare(
      `INSERT INTO apps
         (id, owner_user_id, github_repo_url, display_name,
          default_branch, setup_commands, test_commands, agent_notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      row.id,
      row.owner_user_id,
      row.github_repo_url,
      row.display_name,
      row.default_branch,
      row.setup_commands,
      row.test_commands,
      row.agent_notes,
    )
    .run();
}

export async function createBugReport(
  db: D1Database,
  row: BugReportInsert,
): Promise<void> {
  // status defaults to 'open' and created_at defaults to unixepoch()
  // via the table schema (migration 0001). FK on app_id raises
  // SQLITE_CONSTRAINT if the parent app doesn't exist — callers should
  // pre-validate via getApp() for a friendlier 4xx response.
  await db
    .prepare(
      `INSERT INTO bug_reports
         (id, app_id, reporter_name, title, description, severity)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      row.id,
      row.app_id,
      row.reporter_name,
      row.title,
      row.description,
      row.severity,
    )
    .run();
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
            started_at, created_at, updated_at, agent_variant, cost_credits)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        job.agent_variant,
        job.cost_credits,
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
