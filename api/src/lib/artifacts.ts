// R2 evidence-bundle writer for every fix-job terminal state.
//
// Layout: one bundle per fix_job_id under fix-jobs/<id>/<filename>.
// Files:
//   submitted-bug.json  — bug report identity
//   agent-prompt.txt    — exact user.message string sent to the agent
//                         (read from fix_jobs.prompt_snapshot_text; omitted
//                         if null)
//   run-summary.json    — terminal status + audit trail + token totals + cost
//   pr-metadata.json    — PR url + number + commit + repo coords (omitted on
//                         failed runs without a pr_url)
//   agent-reply-tail.txt — last ~2000 chars of the agent's narration text
//                         (read from result_summary_json.agent_reply_tail;
//                         omitted if absent)
//
// Called from FOUR sites:
//   1. AgentSessionDO finally — covers success / agent_no_push / timeout /
//      generic catch
//   2. AgentSessionDO malformed-URL defensive path — unreachable via the
//      public API today (POST /api/fix-jobs pre-validates) but kept as
//      defense in depth
//   3. /recover branch-missing-past-cutoff failure path
//   4. /recover adoption success path
//
// Critical invariant: writeRunArtifactsBestEffort never throws. Every R2 put
// is wrapped in its own try/catch and logged into the manifest's `failures`
// array; the outer wrapper catches any other error so a manifest persistence
// failure can never mask the original terminal outcome (status / refund /
// terminal SSE have all already landed before this is called).

import type { Bindings } from "../index";
import { getApp, getBugReport, updateFixJob } from "./db";
import type { AppRow, BugReportRow } from "./db";
import { redact } from "./redact";

const BUCKET_NAME = "crowdpatch-artifacts"; // mirrors wrangler.toml:56
const KEY_PREFIX = "fix-jobs"; // bundle root prefix
const REPLY_TAIL_FIELD = "agent_reply_tail"; // key inside result_summary_json
const JSON_CONTENT_TYPE = "application/json";
const TEXT_CONTENT_TYPE = "text/plain; charset=utf-8";

// Minimal row shape — subset of fix_jobs columns the orchestrator needs.
// The GET endpoint inlines its own SELECT at routes/fixJobs.ts:306-329;
// keeping this local avoids forcing the GET endpoint into a shared row type.
export interface FixJobRow {
  id: string;
  app_id: string;
  bug_report_ids_json: string;
  status: string;
  ended_reason: string | null;
  branch_name: string | null;
  pr_url: string | null;
  commit_sha: string | null;
  cost_credits: number;
  started_at: number | null;
  completed_at: number | null;
  result_summary_json: string | null;
  prompt_snapshot_text: string | null;
  anthropic_session_id: string | null;
  anthropic_agent_id: string | null;
  anthropic_environment_id: string | null;
  anthropic_agent_model: string | null;
  anthropic_agent_version: string | null;
  agent_variant: string | null;
  first_input_tokens: number | null;
  first_output_tokens: number | null;
  first_cache_creation_input_tokens: number | null;
  first_cache_read_input_tokens: number | null;
  total_input_tokens: number | null;
  total_output_tokens: number | null;
  total_cache_creation_input_tokens: number | null;
  total_cache_read_input_tokens: number | null;
}

export interface R2ArtifactEntry {
  key: string;
  content_type: string;
  bytes: number;
  written_at: number;
}

export interface R2ArtifactFailure {
  key: string;
  error: string;
}

export interface R2ArtifactManifest {
  bucket: string;
  prefix: string;
  written_at: number;
  artifacts: R2ArtifactEntry[];
  failures?: R2ArtifactFailure[];
}

interface BuiltArtifact {
  body: string;
  contentType: string;
}

// Per-string redaction helper. Numeric / null / undefined pass through.
function r(s: string | null): string | null {
  return s === null ? null : redact(s);
}

// Stable JSON.stringify with 2-space indent — manifests are small and demo
// readability matters more than wire size.
function toJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function utf8ByteLength(s: string): number {
  return new TextEncoder().encode(s).byteLength;
}

// Pure builders — every string field passes through redact() BEFORE the
// containing object is serialized to JSON. Numeric and timestamp fields
// pass through unchanged.

export function buildSubmittedBugBody(bug: BugReportRow): BuiltArtifact {
  const payload = {
    id: bug.id,
    app_id: bug.app_id,
    title: r(bug.title),
    description: r(bug.description),
    severity: bug.severity,
    reporter_name: r(bug.reporter_name),
    status: bug.status,
    created_at: bug.created_at,
  };
  return { body: toJson(payload), contentType: JSON_CONTENT_TYPE };
}

export function buildAgentPromptBody(
  promptSnapshot: string | null,
): BuiltArtifact | null {
  if (promptSnapshot === null || promptSnapshot.length === 0) return null;
  return {
    body: redact(promptSnapshot),
    contentType: TEXT_CONTENT_TYPE,
  };
}

export function buildRunSummaryBody(row: FixJobRow): BuiltArtifact {
  const payload = {
    fix_job_id: row.id,
    status: row.status,
    ended_reason: r(row.ended_reason),
    branch_name: r(row.branch_name),
    pr_url: r(row.pr_url),
    commit_sha: r(row.commit_sha),
    cost_credits: row.cost_credits,
    started_at: row.started_at,
    completed_at: row.completed_at,
    agent_variant: r(row.agent_variant),
    anthropic_session_id: r(row.anthropic_session_id),
    anthropic_agent_id: r(row.anthropic_agent_id),
    anthropic_environment_id: r(row.anthropic_environment_id),
    anthropic_agent_model: r(row.anthropic_agent_model),
    anthropic_agent_version: r(row.anthropic_agent_version),
    first_input_tokens: row.first_input_tokens,
    first_output_tokens: row.first_output_tokens,
    first_cache_creation_input_tokens: row.first_cache_creation_input_tokens,
    first_cache_read_input_tokens: row.first_cache_read_input_tokens,
    total_input_tokens: row.total_input_tokens,
    total_output_tokens: row.total_output_tokens,
    total_cache_creation_input_tokens: row.total_cache_creation_input_tokens,
    total_cache_read_input_tokens: row.total_cache_read_input_tokens,
  };
  return { body: toJson(payload), contentType: JSON_CONTENT_TYPE };
}

export function buildPrMetadataBody(
  row: FixJobRow,
  app: AppRow,
): BuiltArtifact | null {
  if (!row.pr_url) return null;
  const payload = {
    pr_url: r(row.pr_url),
    pr_number: parsePrNumberFromUrl(row.pr_url),
    commit_sha: r(row.commit_sha),
    repo_url: r(app.github_repo_url),
    base_branch: r(app.default_branch),
    branch_name: r(row.branch_name),
  };
  return { body: toJson(payload), contentType: JSON_CONTENT_TYPE };
}

export function buildAgentReplyTailBody(row: FixJobRow): BuiltArtifact | null {
  if (!row.result_summary_json) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(row.result_summary_json);
  } catch {
    return null;
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !(REPLY_TAIL_FIELD in parsed)
  ) {
    return null;
  }
  const tail = (parsed as Record<string, unknown>)[REPLY_TAIL_FIELD];
  if (typeof tail !== "string" || tail.length === 0) return null;
  return { body: redact(tail), contentType: TEXT_CONTENT_TYPE };
}

// Extracts the PR number from a GitHub PR URL like
// https://github.com/owner/repo/pull/42 → 42. Returns null on parse fail.
export function parsePrNumberFromUrl(url: string | null): number | null {
  if (!url) return null;
  const m = url.match(/\/pull\/(\d+)(?:[/?#]|$)/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

// Pure helper — used by both the orchestrator and tests for determinism check.
export function artifactKey(fixJobId: string, filename: string): string {
  return `${KEY_PREFIX}/${fixJobId}/${filename}`;
}

async function loadFixJobRow(
  db: D1Database,
  id: string,
): Promise<FixJobRow | null> {
  const row = await db
    .prepare(
      `SELECT id, app_id, bug_report_ids_json, status, ended_reason,
              branch_name, pr_url, commit_sha, cost_credits, started_at,
              completed_at, result_summary_json, prompt_snapshot_text,
              anthropic_session_id, anthropic_agent_id,
              anthropic_environment_id, anthropic_agent_model,
              anthropic_agent_version, agent_variant,
              first_input_tokens, first_output_tokens,
              first_cache_creation_input_tokens,
              first_cache_read_input_tokens,
              total_input_tokens, total_output_tokens,
              total_cache_creation_input_tokens,
              total_cache_read_input_tokens
         FROM fix_jobs WHERE id = ?`,
    )
    .bind(id)
    .first<FixJobRow>();
  return row ?? null;
}

function firstBugReportId(row: FixJobRow): string | null {
  try {
    const parsed: unknown = JSON.parse(row.bug_report_ids_json);
    if (!Array.isArray(parsed) || parsed.length === 0) return null;
    const ids = parsed as unknown[];
    const first = ids[0];
    return typeof first === "string" ? first : null;
  } catch {
    return null;
  }
}

// Single R2 put with isolated try/catch — failure lands in the manifest's
// `failures` array; never propagates.
async function putOne(
  bucket: R2Bucket,
  key: string,
  built: BuiltArtifact,
  artifacts: R2ArtifactEntry[],
  failures: R2ArtifactFailure[],
  writtenAt: number,
): Promise<void> {
  try {
    await bucket.put(key, built.body, {
      httpMetadata: { contentType: built.contentType },
    });
    artifacts.push({
      key,
      content_type: built.contentType,
      bytes: utf8ByteLength(built.body),
      written_at: writtenAt,
    });
  } catch (err) {
    failures.push({
      key,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// I/O orchestrator. Loads the fresh fix_jobs row + first bug_report + app,
// builds each artifact, puts each one independently, returns the manifest.
// Never throws — any unrecoverable error returns null (and the caller logs).
export async function writeRunArtifacts(
  env: Bindings,
  fixJobId: string,
): Promise<R2ArtifactManifest | null> {
  const row = await loadFixJobRow(env.DB, fixJobId);
  if (!row) return null;

  const bugId = firstBugReportId(row);
  const bug = bugId ? await getBugReport(env.DB, bugId) : null;
  const app = await getApp(env.DB, row.app_id);

  const writtenAt = Math.floor(Date.now() / 1000);
  const artifacts: R2ArtifactEntry[] = [];
  const failures: R2ArtifactFailure[] = [];
  const bucket = env.ARTIFACTS;

  // submitted-bug.json — only emit if the bug row loaded.
  if (bug) {
    await putOne(
      bucket,
      artifactKey(fixJobId, "submitted-bug.json"),
      buildSubmittedBugBody(bug),
      artifacts,
      failures,
      writtenAt,
    );
  }

  // agent-prompt.txt — only emit if the prompt was captured.
  const promptArtifact = buildAgentPromptBody(row.prompt_snapshot_text);
  if (promptArtifact) {
    await putOne(
      bucket,
      artifactKey(fixJobId, "agent-prompt.txt"),
      promptArtifact,
      artifacts,
      failures,
      writtenAt,
    );
  }

  // run-summary.json — always emit (the row exists by definition here).
  await putOne(
    bucket,
    artifactKey(fixJobId, "run-summary.json"),
    buildRunSummaryBody(row),
    artifacts,
    failures,
    writtenAt,
  );

  // pr-metadata.json — only when both pr_url and app are available.
  if (app) {
    const prMeta = buildPrMetadataBody(row, app);
    if (prMeta) {
      await putOne(
        bucket,
        artifactKey(fixJobId, "pr-metadata.json"),
        prMeta,
        artifacts,
        failures,
        writtenAt,
      );
    }
  }

  // agent-reply-tail.txt — only when the agent narration was persisted.
  const replyTail = buildAgentReplyTailBody(row);
  if (replyTail) {
    await putOne(
      bucket,
      artifactKey(fixJobId, "agent-reply-tail.txt"),
      replyTail,
      artifacts,
      failures,
      writtenAt,
    );
  }

  const manifest: R2ArtifactManifest = {
    bucket: BUCKET_NAME,
    prefix: `${KEY_PREFIX}/${fixJobId}/`,
    written_at: writtenAt,
    artifacts,
  };
  if (failures.length > 0) manifest.failures = failures;
  return manifest;
}

// Single public surface for the DO + /recover. Catches every error,
// console.warns, and persists the manifest to D1 if non-null. Never throws —
// the original terminal outcome is already persisted by the time this runs.
export async function writeRunArtifactsBestEffort(
  env: Bindings,
  fixJobId: string,
): Promise<void> {
  try {
    const manifest = await writeRunArtifacts(env, fixJobId);
    if (manifest !== null) {
      await updateFixJob(env.DB, fixJobId, {
        artifact_manifest_json: JSON.stringify(manifest),
      });
    }
  } catch (err) {
    console.warn("[artifacts] write failed", err);
  }
}
