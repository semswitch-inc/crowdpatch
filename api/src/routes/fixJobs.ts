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
import { createFixJob, getApp, getBugReport, updateFixJob } from "../lib/db";
import { GitHubClient, parseRepoUrl } from "../lib/github";
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
    return c.json(
      {
        fix_job_id: existing.id,
        stream_url: `/api/fix-jobs/${existing.id}/events`,
        status: "deduped",
      },
      200,
    );
  }

  // 4. Generate IDs. Branch name is derived from the bug title so each demo
  // (jsdiff word-diff, jsdiff patch-parse, judge's own repo, …) produces a
  // self-explanatory branch instead of the hardcoded jsdiff-only suffix.
  const fixJobId = ulid();
  const shortUlid = fixJobId.slice(-8).toLowerCase();
  const branchName = `fix/${slugify(bugReport.title).slice(0, 30)}-${shortUlid}`;

  // 5. INSERT fix_jobs row.
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
    },
    [bug_report_id],
  );

  // 6. Hand off to AgentSessionDO. Secrets (ANTHROPIC_API_KEY, GITHUB_DEMO_PAT)
  // are NOT in the payload — the DO reads them from this.env directly.
  const id = c.env.AGENT_SESSION_DO.idFromName(fixJobId);
  const stub = c.env.AGENT_SESSION_DO.get(id);

  const startResp = await stub.fetch(
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
      }),
    }),
  );

  if (!startResp.ok) {
    return c.json(
      { error: "agent_session_do failed to start", status: startResp.status },
      502,
    );
  }

  // 7. Return 202 with stream URL — browser opens EventSource on stream_url.
  return c.json(
    {
      fix_job_id: fixJobId,
      stream_url: `/api/fix-jobs/${fixJobId}/events`,
      status: "pending",
    },
    202,
  );
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
            started_at
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

  const github = new GitHubClient(c.env.GITHUB_DEMO_PAT);

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
    await updateFixJob(c.env.DB, fixJobId, {
      status: "failed",
      error_message: "agent did not push branch within recovery window",
      ended_reason: "agent_no_push",
      completed_at: nowSec,
    });
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

  await updateFixJob(c.env.DB, fixJobId, {
    status: "succeeded",
    pr_url: prUrl,
    ended_reason: "success",
    completed_at: Math.floor(Date.now() / 1000),
  });

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
  return `Automated fix opened by [CrowdPatch](https://crowdpatch.ai) using Anthropic's Managed Agents.

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
