// POST /api/fix-jobs           — kick off a fix-job (returns 202 immediately)
// GET  /api/fix-jobs/:id/events — subscribe to live SSE event stream
//
// Day 2 architecture: the Worker no longer drives the agent itself. It
// validates, INSERTs the fix_jobs row, and hands the job off to an
// AgentSessionDO (one DO instance per fix_job_id). The DO owns the agent
// session lifecycle, persists semantic events to its SQLite, and fans out
// SSE to N concurrent subscribers. See .agents/plans/sequential-soaring-plum.md
// §"Step 3" for the full spec.

import { Hono } from "hono";
import { ulid } from "ulid";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";

import type { Bindings } from "../index";
import { writeRunArtifactsBestEffort } from "../lib/artifacts";
import {
  DEMO_USER_ID,
  PATCH_COST,
  chargeForFixJob,
  getBalance,
  ledgerEntryExists,
  rechargeForFixJob,
  refundForFixJob,
} from "../lib/credits";
import { createFixJob, getApp, getBugReport, updateFixJob } from "../lib/db";
import { GitHubClient, parseRepoUrl } from "../lib/github";
import { redact } from "../lib/redact";
import { REPO_TOKEN_HEADER, isValidRepoTokenFormat } from "../lib/repoToken";
import { slugify } from "../lib/text";

const fixJobs = new Hono<{ Bindings: Bindings }>();

const PostBody = z.object({
  bug_report_id: z.string().min(1),
  // Optional prompt-variant selector. Maps to ANTHROPIC_AGENT_ID_<X> env var
  // at request time. Omitted → uses the default ANTHROPIC_AGENT_ID. Used to
  // A/B/C/D-test prompt variants against the Anthropic safety classifier
  // without mutating one shared agent in the dashboard.
  agent_variant: z.enum(["A", "B", "C", "D"]).optional(),
});

type AgentVariant = "A" | "B" | "C" | "D";

// ULID format: 26 chars, Crockford base32 (no I, L, O, U).
const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;

fixJobs.post("/fix-jobs", zValidator("json", PostBody), async (c) => {
  const { bug_report_id, agent_variant } = c.req.valid("json");

  // 1. Bootstrap + variant resolution. The default agent ID is required even
  // when a variant is requested, because environment_id is not variant-keyed
  // and we still 503 if the bootstrap was never run.
  const defaultAgentId = c.env.ANTHROPIC_AGENT_ID;
  const environmentId = c.env.ANTHROPIC_ENVIRONMENT_ID;
  if (!defaultAgentId || !environmentId) {
    return c.json(
      {
        error:
          "agent/environment not bootstrapped — run `npm run bootstrap:anthropic`",
      },
      503,
    );
  }

  let agentId: string;
  if (agent_variant) {
    const variantSecret = lookupVariantSecret(c.env, agent_variant);
    if (!variantSecret) {
      return c.json(
        {
          error: `agent_variant ${agent_variant} requested but ANTHROPIC_AGENT_ID_${agent_variant} secret is not set`,
        },
        503,
      );
    }
    agentId = variantSecret;
  } else {
    agentId = defaultAgentId;
  }

  // 2. Resolve bug_report + app
  const bugReport = await getBugReport(c.env.DB, bug_report_id);
  if (!bugReport) {
    return c.json({ error: "bug_report not found" }, 404);
  }

  const app = await getApp(c.env.DB, bugReport.app_id);
  if (!app) {
    return c.json({ error: "app not found" }, 404);
  }

  if (!parseRepoUrl(app.github_repo_url)) {
    return c.json(
      {
        error: `app.github_repo_url is malformed: ${app.github_repo_url}`,
      },
      500,
    );
  }

  // 3. Idempotency check — exact join on fix_job_bug_reports (NOT a LIKE on
  // bug_report_ids_json which can false-match similar IDs). Returns the most
  // recent active job for this (app, bug_report, agent_variant) within a 60s
  // window. agent_variant is part of the dedup key because different variants
  // are legitimately different jobs (an A/B/C/D tournament against the same
  // bug should produce 4 jobs, not 1). Uses `IS` (not `=`) so NULL variants
  // dedup against other NULL variants — SQLite-specific NULL-safe equality.
  // Caveat: read-then-insert without a unique constraint, so two POSTs in
  // the same millisecond can both miss the check and create two jobs.
  // Acceptable for hackathon demo; stronger guarantee = Day 3+.
  const existing = await c.env.DB.prepare(
    `SELECT fj.id AS id
       FROM fix_jobs fj
       INNER JOIN fix_job_bug_reports fjbr ON fjbr.fix_job_id = fj.id
      WHERE fj.app_id = ?
        AND fjbr.bug_report_id = ?
        AND fj.agent_variant IS ?
        AND fj.created_at > unixepoch() - 60
        AND fj.status IN ('pending','running','succeeded')
      ORDER BY fj.created_at DESC
      LIMIT 1`,
  )
    .bind(app.id, bug_report_id, agent_variant ?? null)
    .first<{ id: string }>();

  if (existing) {
    // Dedup-first: deduped requests reconnect to an in-flight job and MUST
    // NOT trigger a new charge or balance check. The original job's charge
    // (if any) already landed when its row was created. The header check
    // below is intentionally skipped on dedup — the original POST already
    // validated the PAT and the BYO run is in flight under the original
    // auth_mode='user_pat' marker; reconnecting from another tab without
    // the header is a legitimate UX path.
    return c.json(
      {
        fix_job_id: existing.id,
        stream_url: `/api/fix-jobs/${existing.id}/events`,
        status: "deduped",
      },
      200,
    );
  }

  // 3a. BYO-token decision matrix. The repo PAT travels via the
  // X-CrowdPatch-Repo-Token header and is NEVER persisted — only the
  // `auth_mode` class is stored on the row so /recover can refuse the
  // demo-PAT fallback on BYO runs.
  //
  // Decision table:
  //   bundled jsdiff demo repo + no header → demo_pat (env.GITHUB_DEMO_PAT)
  //   bundled jsdiff demo repo + header    → user_pat (header token)
  //   any other repo            + no header → 400 repo_token_required
  //                                          (no row, no charge, no DO call)
  //   any other repo            + header   → user_pat (header token)
  //
  // The fail-closed behavior on "any other repo + no header" is deliberate:
  // silently using GITHUB_DEMO_PAT against a non-demo repo would 401 inside
  // the agent run and look like a Claude / Anthropic / sandbox failure,
  // confusing the demo. We surface the misuse at the request boundary.
  const demoCoords = parseRepoUrl(c.env.DEMO_REPO_URL);
  if (!demoCoords) {
    return c.json(
      {
        error: "demo_repo_misconfigured",
        message: "DEMO_REPO_URL env var is not a valid github.com repo URL.",
      },
      503,
    );
  }
  const repoCoords = parseRepoUrl(app.github_repo_url);
  // parseRepoUrl on app.github_repo_url already passed the malformed check
  // above; assert here only to please TS narrowing.
  if (!repoCoords) {
    return c.json({ error: "app_repo_url_unparseable" }, 500);
  }
  const isBundledDemoRepo =
    repoCoords.owner.toLowerCase() === demoCoords.owner.toLowerCase() &&
    repoCoords.repo.toLowerCase() === demoCoords.repo.toLowerCase();

  const repoTokenHeader = c.req.header(REPO_TOKEN_HEADER);
  let userPat: string | null = null;
  if (repoTokenHeader !== undefined && repoTokenHeader !== "") {
    if (!isValidRepoTokenFormat(repoTokenHeader)) {
      return c.json(
        {
          error: "invalid_repo_token_format",
          message:
            "Repo token must be a fine-grained GitHub PAT (github_pat_…).",
        },
        400,
      );
    }
    userPat = repoTokenHeader;
  } else if (!isBundledDemoRepo) {
    return c.json(
      {
        error: "repo_token_required",
        message:
          "This repo isn't the bundled demo. Provide your own GitHub PAT via the X-CrowdPatch-Repo-Token header to run a patch on it.",
      },
      400,
    );
  }
  const authMode: "demo_pat" | "user_pat" =
    userPat !== null ? "user_pat" : "demo_pat";

  // 4. Pre-flight balance check — only on the truly-new path. Refuse with
  // 402 (Payment Required) if the demo user can't afford the patch. The
  // frontend uses this to show a "claim more credits" prompt instead of
  // silently going negative.
  const balance = await getBalance(c.env.DB, DEMO_USER_ID);
  if (balance < PATCH_COST) {
    return c.json(
      {
        error: "insufficient_credits",
        needed: PATCH_COST,
        balance,
        user_id: DEMO_USER_ID,
      },
      402,
    );
  }

  // 5. Generate IDs. Branch name is derived from the bug title so each demo
  // (jsdiff word-diff, jsdiff patch-parse, judge's own repo, …) produces a
  // self-explanatory branch instead of the hardcoded jsdiff-only suffix.
  const fixJobId = ulid();
  const shortUlid = fixJobId.slice(-8).toLowerCase();
  const branchName = `fix/${slugify(bugReport.title).slice(0, 30)}-${shortUlid}`;

  // 6. INSERT fix_jobs row with cost_credits stamped at creation. Refunds
  // and recharges read this per-row value, so any future per-app/per-variant
  // pricing won't break historical refund correctness.
  // status='pending' — the DO bumps it to 'running' once it actually begins.
  // started_at is set NOW even with status='pending' because updateFixJob()
  // doesn't allow started_at updates and the lifecycle clock starts here.
  await createFixJob(
    c.env.DB,
    {
      id: fixJobId,
      app_id: app.id,
      bug_report_ids_json: JSON.stringify([bug_report_id]),
      branch_name: branchName,
      status: "pending",
      started_at: Math.floor(Date.now() / 1000),
      agent_variant: agent_variant ?? null,
      cost_credits: PATCH_COST,
      // Audit trail: stamp which (agent, environment) ran this job. Already
      // resolved above (defaultAgentId or per-variant secret + environmentId);
      // persisting them here means a future env-var rotation doesn't lose the
      // historical mapping.
      anthropic_agent_id: agentId,
      anthropic_environment_id: environmentId,
      auth_mode: authMode,
    },
    [bug_report_id],
  );

  // 7. Hand off to AgentSessionDO in a try/catch so a DO-start failure can
  // mark the row failed WITHOUT issuing a charge. We charge AFTER the DO
  // start confirms — eliminates the orphan-charge window.
  // Secrets (ANTHROPIC_API_KEY, GITHUB_DEMO_PAT) are NOT in the payload —
  // the DO reads them from this.env directly.
  const id = c.env.AGENT_SESSION_DO.idFromName(fixJobId);
  const stub = c.env.AGENT_SESSION_DO.get(id);

  let startResp: Response;
  try {
    startResp = await stub.fetch(
      new Request("https://do.local/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fix_job_id: fixJobId,
          bug_report: bugReport,
          app,
          branch_name: branchName,
          anthropic_agent_id: agentId,
          anthropic_environment_id: environmentId,
          // Forward the BYO PAT to the DO via the in-memory worker→DO RPC
          // fetch. Cloudflare doesn't log the body of internal RPC calls;
          // the DO consumes the token in-memory and never persists it.
          ...(userPat !== null ? { github_token_override: userPat } : {}),
        }),
      }),
    );
  } catch (err) {
    await markFixJobDoStartFailed(
      c.env,
      fixJobId,
      err instanceof Error ? err.message : String(err),
    );
    return c.json(
      { error: "agent_session_do unreachable", status: "do_start_failed" },
      500,
    );
  }

  if (!startResp.ok) {
    await markFixJobDoStartFailed(
      c.env,
      fixJobId,
      `DO /start returned ${String(startResp.status)}`,
    );
    return c.json(
      { error: "agent_session_do failed to start", status: startResp.status },
      502,
    );
  }

  // 8. Charge — DO start confirmed, so the user is getting a real run.
  // chargeForFixJob is idempotent (key=charge:<fix_job_id>) — a duplicate
  // call would be a no-op. We log but don't fail the request if the charge
  // write fails: the user has a working run; charge correctness is recoverable
  // in a later sweep, but a 5xx here would orphan the running DO.
  let postChargeBalance = balance;
  try {
    const chargeResult = await chargeForFixJob(c.env.DB, fixJobId);
    postChargeBalance = chargeResult.balanceAfter;
  } catch (err) {
    console.warn(
      `[fix-jobs] charge failed for ${fixJobId}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // 9. Return 202 with stream URL — browser opens EventSource on stream_url.
  return c.json(
    {
      fix_job_id: fixJobId,
      stream_url: `/api/fix-jobs/${fixJobId}/events`,
      status: "pending",
      balance_after: postChargeBalance,
    },
    202,
  );
});

async function markFixJobDoStartFailed(
  env: Bindings,
  fixJobId: string,
  detail: string,
): Promise<void> {
  // No refund — the DO never started, so no charge was issued. This matches
  // the plan's decision-#5(g) operation order.
  // redact() is defense in depth: a BYO-token run that fails inside the
  // worker→DO fetch could in theory surface header bytes inside the thrown
  // error message; redact() strips github_pat_*, ghp_*, sk-ant-*, Bearer *
  // before the string lands in D1.error_message (which is itself surfaced
  // back to the UI via the error_event SSE card and to R2 artifacts).
  await updateFixJob(env.DB, fixJobId, {
    status: "failed",
    error_message: redact(detail).slice(0, 500),
    ended_reason: "do_start_failed",
    completed_at: Math.floor(Date.now() / 1000),
  });
  // Write a minimal R2 evidence bundle so the "every run writes artifacts"
  // invariant holds even when the DO never starts. agent-prompt.txt is
  // omitted (prompt_snapshot_text is NULL — the session was never opened);
  // the bundle still contains submitted-bug.json + run-summary.json with
  // status=failed/ended_reason=do_start_failed. Best-effort: never throws.
  await writeRunArtifactsBestEffort(env, fixJobId);
}

// GET /api/fix-jobs/:id — return the fix_jobs row + telemetry. Used by the
// web client AFTER the terminal SSE event to surface cumulative session
// usage (input/output/cache tokens) and the persisted agent + environment
// + model + version IDs. Polled with backoff because the DO writes
// total_*_tokens inside the runAgent finally block AFTER the terminal SSE
// has already been broadcast — so the first GET can race the persistence.
fixJobs.get("/fix-jobs/:id", async (c) => {
  const fixJobId = c.req.param("id");
  if (!ULID_RE.test(fixJobId)) {
    return c.json({ error: "invalid fix_job_id" }, 400);
  }

  const row = await c.env.DB.prepare(
    `SELECT id, status, branch_name, pr_url, ended_reason,
            agent_variant,
            anthropic_agent_id, anthropic_environment_id,
            anthropic_agent_model, anthropic_agent_version,
            anthropic_session_id,
            total_input_tokens, total_output_tokens,
            total_cache_creation_input_tokens, total_cache_read_input_tokens,
            first_input_tokens, first_output_tokens,
            first_cache_creation_input_tokens, first_cache_read_input_tokens,
            started_at, completed_at, cost_credits,
            artifact_manifest_json
       FROM fix_jobs WHERE id = ?`,
  )
    .bind(fixJobId)
    .first<{
      id: string;
      status: string;
      branch_name: string | null;
      pr_url: string | null;
      ended_reason: string | null;
      agent_variant: string | null;
      anthropic_agent_id: string | null;
      anthropic_environment_id: string | null;
      anthropic_agent_model: string | null;
      anthropic_agent_version: string | null;
      anthropic_session_id: string | null;
      total_input_tokens: number | null;
      total_output_tokens: number | null;
      total_cache_creation_input_tokens: number | null;
      total_cache_read_input_tokens: number | null;
      first_input_tokens: number | null;
      first_output_tokens: number | null;
      first_cache_creation_input_tokens: number | null;
      first_cache_read_input_tokens: number | null;
      started_at: number | null;
      completed_at: number | null;
      cost_credits: number;
      artifact_manifest_json: string | null;
    }>();
  if (!row) {
    return c.json({ error: "fix_job not found" }, 404);
  }

  return c.json(row);
});

// SSE stream of agent events for a given fix_job_id.
// Browser uses native EventSource (GET-only); Worker proxies to DO /subscribe.
fixJobs.get("/fix-jobs/:id/events", async (c) => {
  const fixJobId = c.req.param("id");
  if (!ULID_RE.test(fixJobId)) {
    return c.json({ error: "invalid fix_job_id" }, 400);
  }

  // Verify the fix_job actually exists in D1 — avoids subscribing to an
  // empty Durable Object on a typo and hanging the SSE connection.
  const exists = await c.env.DB.prepare(
    "SELECT 1 AS x FROM fix_jobs WHERE id = ? LIMIT 1",
  )
    .bind(fixJobId)
    .first<{ x: number }>();
  if (!exists) {
    return c.json({ error: "fix_job not found" }, 404);
  }

  const id = c.env.AGENT_SESSION_DO.idFromName(fixJobId);
  const stub = c.env.AGENT_SESSION_DO.get(id);

  const doResp = await stub.fetch(
    new Request("https://do.local/subscribe", { method: "GET" }),
  );

  // Pass the streaming body through. CORS is applied at /api/* by the
  // Hono cors() middleware in src/index.ts.
  return new Response(doResp.body, {
    status: doResp.status,
    headers: new Headers(doResp.headers),
  });
});

// POST /api/fix-jobs/:id/recover — finalizes a fix-job whose DO hibernated
// mid-session OR whose Anthropic stream connection dropped before AGENT_DONE
// landed (so the DO mislabelled the job 'failed'/'agent_error' even though
// the agent pushed the branch on its side). Idempotent: safe to call
// multiple times.
//
// Logic:
//   - status='succeeded' AND pr_url present → return as-is (truly idempotent)
//   - status='cancelled' → return as-is (deliberate cancel; never resurrect)
//   - status in ('pending','running','failed','succeeded-without-pr_url')
//     → check GitHub:
//       - branch exists + PR exists → adopt that PR, mark succeeded
//       - branch exists + no PR     → open PR, mark succeeded
//       - branch missing + status was already 'failed' → return failed as-is
//                                                        (do NOT rewrite the
//                                                        existing ended_reason)
//       - branch missing + young    → return 202 still_running (NO DB update)
//       - branch missing + old      → mark failed agent_no_push
//
// "Young" = job age < RECOVERY_CUTOFF_SEC. Critical: marking a job failed
// just because we don't see a branch yet would race-fail mid-run agents
// that are still doing yarn install / running tests / writing the fix.
// The DO's own 10min Anthropic-session timeout (SESSION_TIMEOUT_MS) bounds
// real work; we use 12min here to give a 2min safety margin for the agent
// to push the branch after the session ends but before we declare failure.
//
// Front-end calls this on SSE silence as a safety net for Cloudflare DO
// hibernation. Front-end MUST treat still_running as "keep waiting", not
// as failure — see web/components/FixBugButton.tsx watchdog.
const RECOVERY_CUTOFF_SEC = 12 * 60;

fixJobs.post("/fix-jobs/:id/recover", async (c) => {
  const fixJobId = c.req.param("id");
  if (!ULID_RE.test(fixJobId)) {
    return c.json({ error: "invalid fix_job_id" }, 400);
  }

  const job = await c.env.DB.prepare(
    `SELECT id, app_id, branch_name, status, pr_url, bug_report_ids_json,
            started_at, auth_mode
       FROM fix_jobs WHERE id = ?`,
  )
    .bind(fixJobId)
    .first<{
      id: string;
      app_id: string;
      branch_name: string | null;
      status: string;
      pr_url: string | null;
      bug_report_ids_json: string;
      started_at: number | null;
      auth_mode: "demo_pat" | "user_pat";
    }>();
  if (!job) {
    return c.json({ error: "fix_job not found" }, 404);
  }

  // Truly idempotent: if we already have a successful outcome with a PR,
  // return as-is. (Without pr_url the row is in an inconsistent state, so
  // fall through to GitHub for branch adoption.)
  if (job.status === "succeeded" && job.pr_url) {
    return c.json({
      status: "succeeded",
      pr_url: job.pr_url,
      recovered: false,
      reason: "already_succeeded",
    });
  }

  // Cancelled is a deliberate end state; do not resurrect.
  if (job.status === "cancelled") {
    return c.json({
      status: "cancelled",
      pr_url: job.pr_url,
      recovered: false,
      reason: "cancelled_terminal",
    });
  }

  if (!job.branch_name) {
    // No branch recorded. If already failed, respect the existing terminal
    // state; otherwise this is a structural problem (running/pending job
    // never got far enough to assign a branch).
    if (job.status === "failed") {
      return c.json({
        status: "failed",
        pr_url: job.pr_url,
        recovered: false,
        reason: "no_branch_recorded",
      });
    }
    return c.json(
      { error: "fix_job has no branch_name; nothing to recover" },
      409,
    );
  }

  const app = await getApp(c.env.DB, job.app_id);
  if (!app) {
    return c.json({ error: "app not found for fix_job" }, 500);
  }
  const repoCoords = parseRepoUrl(app.github_repo_url);
  if (!repoCoords) {
    return c.json(
      { error: `app.github_repo_url malformed: ${app.github_repo_url}` },
      500,
    );
  }

  // BYO-token recovery decision matrix (mirrors POST /fix-jobs §3a):
  //   row.auth_mode='demo_pat' → use env.GITHUB_DEMO_PAT, ignore any header
  //   row.auth_mode='user_pat' + header valid → use the header token
  //   row.auth_mode='user_pat' + no header    → refund (idempotent), mark
  //     failed user_pat_lost, return 409 user_pat_required. Honest UX:
  //     the PAT was never stored, so a tab reload that lost the React
  //     state cannot resurrect the run.
  //   row.auth_mode='user_pat' + invalid format → 400, no state change
  //     (defensive — the format already passed at /fix-jobs POST time).
  let recoveryToken: string;
  if (job.auth_mode === "user_pat") {
    const headerToken = c.req.header(REPO_TOKEN_HEADER);
    if (headerToken === undefined || headerToken === "") {
      try {
        await refundForFixJob(c.env.DB, fixJobId);
      } catch (err) {
        console.warn(
          `[recover] refund failed for ${fixJobId}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
      await updateFixJob(c.env.DB, fixJobId, {
        status: "failed",
        error_message: "BYO PAT was not re-supplied on recovery",
        ended_reason: "user_pat_lost",
        completed_at: Math.floor(Date.now() / 1000),
      });
      await writeRunArtifactsBestEffort(c.env, fixJobId);
      return c.json(
        {
          error: "user_pat_required",
          status: "failed",
          ended_reason: "user_pat_lost",
          recovered: true,
          message:
            "We never store your PAT. The browser tab lost the session — your credits have been refunded. If your repo has a fix/* branch, the agent already pushed it; you can open the PR manually.",
        },
        409,
      );
    }
    if (!isValidRepoTokenFormat(headerToken)) {
      return c.json(
        {
          error: "invalid_repo_token_format",
          message:
            "Repo token must be a fine-grained GitHub PAT (github_pat_…).",
        },
        400,
      );
    }
    recoveryToken = headerToken;
  } else {
    recoveryToken = c.env.GITHUB_DEMO_PAT;
  }

  const github = new GitHubClient(recoveryToken);

  const branchExists = await github.branchExists(
    repoCoords.owner,
    repoCoords.repo,
    job.branch_name,
  );

  if (!branchExists) {
    // Job was already marked failed by the DO and the branch isn't on
    // origin either — leave the row's existing ended_reason intact rather
    // than rewriting it to agent_no_push.
    if (job.status === "failed") {
      return c.json({
        status: "failed",
        pr_url: job.pr_url,
        recovered: false,
        reason: "branch_missing_already_failed",
      });
    }

    const nowSec = Math.floor(Date.now() / 1000);
    const ageSec = job.started_at !== null ? nowSec - job.started_at : null;

    // Young job + no branch = agent likely still working. Don't false-fail.
    if (ageSec !== null && ageSec < RECOVERY_CUTOFF_SEC) {
      return c.json(
        {
          status: "still_running",
          age_seconds: ageSec,
          cutoff_seconds: RECOVERY_CUTOFF_SEC,
          retry_after_seconds: 30,
        },
        202,
      );
    }

    // Old job + no branch = genuine failure. (Or started_at missing — old
    // pre-Day-2 rows won't have it; treat unknown age as past-cutoff.)
    // Refund BEFORE updateFixJob so the credit is back in D1 before any
    // downstream listener reads the post-failure state.
    try {
      await refundForFixJob(c.env.DB, fixJobId);
    } catch (err) {
      console.warn(
        `[recover] refund failed for ${fixJobId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    await updateFixJob(c.env.DB, fixJobId, {
      status: "failed",
      error_message: "agent did not push branch within recovery window",
      ended_reason: "agent_no_push",
      completed_at: nowSec,
    });
    // Refresh the R2 evidence bundle to reflect the post-recovery terminal
    // state (agent_no_push instead of whatever the DO had recorded). Best-
    // effort; never throws.
    await writeRunArtifactsBestEffort(c.env, fixJobId);
    return c.json({
      status: "failed",
      ended_reason: "agent_no_push",
      age_seconds: ageSec,
      recovered: true,
    });
  }

  // Branch exists. Find or create PR (idempotent).
  let prUrl: string;
  let prNumber: number;

  const existingPr = await github.findOpenPrForBranch(
    repoCoords.owner,
    repoCoords.repo,
    job.branch_name,
  );

  if (existingPr) {
    prUrl = existingPr.html_url;
    prNumber = existingPr.number;
  } else {
    // Need bug report for PR title. The fix_jobs row has a JSON array of
    // bug_report_ids; use the first one (single-bug jobs are the only
    // shape today). Recovery PRs use a simpler body than the DO's success
    // path because we don't have the agent's reasoning text here.
    const bugReportIds: string[] = JSON.parse(
      job.bug_report_ids_json,
    ) as string[];
    const firstBugId = bugReportIds[0];
    if (!firstBugId) {
      return c.json({ error: "fix_job has no bug_report_ids" }, 500);
    }
    const bugReport = await getBugReport(c.env.DB, firstBugId);
    if (!bugReport) {
      return c.json({ error: "bug_report not found for recovery" }, 500);
    }

    const pr = await github.openPr({
      owner: repoCoords.owner,
      repo: repoCoords.repo,
      head: job.branch_name,
      base: app.default_branch,
      title: `[CrowdPatch] Fix: ${bugReport.title}`,
      body: buildRecoveryPrBody(
        bugReport.title,
        bugReport.description,
        fixJobId,
      ),
    });
    prUrl = pr.html_url;
    prNumber = pr.number;
  }

  // Recovery re-charge guardrail: if this job was previously refunded
  // (i.e. the DO marked it failed and we issued refund:<id>), we now owe
  // the patch cost back because adoption produced a real PR. Only fires
  // when refund:<id> exists in the ledger — old historical failed jobs
  // (pre-credits-system) have no refund row → no surprise debit.
  // rechargeForFixJob is idempotent (key=recharge:<id>), so duplicate
  // /recover calls won't double-debit.
  const previouslyRefunded = await ledgerEntryExists(
    c.env.DB,
    `refund:${fixJobId}`,
  );
  if (previouslyRefunded) {
    try {
      await rechargeForFixJob(c.env.DB, fixJobId);
    } catch (err) {
      console.warn(
        `[recover] recharge failed for ${fixJobId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  await updateFixJob(c.env.DB, fixJobId, {
    status: "succeeded",
    pr_url: prUrl,
    ended_reason: "success",
    completed_at: Math.floor(Date.now() / 1000),
  });
  // Refresh the R2 evidence bundle so run-summary.json + pr-metadata.json
  // reflect the adopted PR. The original DO run may have written a manifest
  // with status:failed; this overwrites under the same keys. Best-effort.
  await writeRunArtifactsBestEffort(c.env, fixJobId);

  return c.json({
    status: "succeeded",
    pr_url: prUrl,
    pr_number: prNumber,
    recovered: true,
  });
});

function buildRecoveryPrBody(
  bugTitle: string,
  bugDescription: string,
  fixJobId: string,
): string {
  const trimmedDesc =
    bugDescription.length > 400
      ? `${bugDescription.slice(0, 400)}…`
      : bugDescription;
  const blockquote = trimmedDesc
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
  return `Automated fix opened by [CrowdPatch](https://crowdpatch.dev) using Anthropic's Managed Agents.

**Submitted report**
- Title: ${bugTitle}

${blockquote}

**Fix job:** \`${fixJobId}\`

---

The agent investigated the failing tests, identified the root cause, applied a surgical fix, and verified the test suite passes locally before pushing this branch.

🤖 _Opened via CrowdPatch's recovery flow after the live agent session completed off-band. Branch + commit are 100% the agent's work._`;
}

// Resolve A/B/C/D → corresponding env-var secret, or undefined if unset.
// Switch (not Bindings[`ANTHROPIC_AGENT_ID_${v}`]) so the property accesses
// stay statically typed and TypeScript checks each branch against the
// optional fields we declared on Bindings.
function lookupVariantSecret(
  env: Bindings,
  variant: AgentVariant,
): string | undefined {
  switch (variant) {
    case "A":
      return env.ANTHROPIC_AGENT_ID_A;
    case "B":
      return env.ANTHROPIC_AGENT_ID_B;
    case "C":
      return env.ANTHROPIC_AGENT_ID_C;
    case "D":
      return env.ANTHROPIC_AGENT_ID_D;
  }
}

export default fixJobs;
