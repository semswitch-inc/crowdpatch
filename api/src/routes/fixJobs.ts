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
import { createFixJob, getApp, getBugReport } from "../lib/db";
import { parseRepoUrl } from "../lib/github";

const fixJobs = new Hono<{ Bindings: Bindings }>();

const PostBody = z.object({
  bug_report_id: z.string().min(1),
});

// ULID format: 26 chars, Crockford base32 (no I, L, O, U).
const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;

fixJobs.post("/fix-jobs", zValidator("json", PostBody), async (c) => {
  // 1. Bootstrap check
  const agentId = c.env.ANTHROPIC_AGENT_ID;
  const environmentId = c.env.ANTHROPIC_ENVIRONMENT_ID;
  if (!agentId || !environmentId) {
    return c.json(
      {
        error:
          "agent/environment not bootstrapped — run `npm run bootstrap:anthropic`",
      },
      503,
    );
  }

  const { bug_report_id } = c.req.valid("json");

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
  // recent active job for this (app, bug_report) within a 60s window.
  // Caveat: read-then-insert without a unique constraint, so two POSTs in
  // the same millisecond can both miss the check and create two jobs.
  // Acceptable for hackathon demo; stronger guarantee = Day 3+.
  const existing = await c.env.DB.prepare(
    `SELECT fj.id AS id
       FROM fix_jobs fj
       INNER JOIN fix_job_bug_reports fjbr ON fjbr.fix_job_id = fj.id
      WHERE fj.app_id = ?
        AND fjbr.bug_report_id = ?
        AND fj.created_at > unixepoch() - 60
        AND fj.status IN ('pending','running','succeeded')
      ORDER BY fj.created_at DESC
      LIMIT 1`,
  )
    .bind(app.id, bug_report_id)
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

  // 4. Generate IDs
  const fixJobId = ulid();
  const shortUlid = fixJobId.slice(-8).toLowerCase();
  const branchName = `fix/word-diff-whitespace-${shortUlid}`;

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

export default fixJobs;
