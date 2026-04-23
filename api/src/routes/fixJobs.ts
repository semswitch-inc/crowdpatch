// POST /api/fix-jobs — synchronous MVP per .agents/plans/sequential-soaring-plum.md §2.5.
//
// Flow:
//   1. Validate body (zod), check agent/env IDs are bootstrapped
//   2. Resolve bug_report + app from D1
//   3. Generate fix_job_id + branch_name (ulid suffix)
//   4. INSERT fix_jobs row (status=running) + join row
//   5. Create Anthropic session with github_repository resource
//   6. STREAM-FIRST: open events.stream(...) BEFORE events.send(...)
//   7. Drain events with 10-min Promise.race timeout
//   8. Verify branch exists on remote (Octokit precondition)
//   9. Open PR via Octokit
//  10. UPDATE fix_jobs (succeeded), return PR URL
//
// On any throw: best-effort archive the session + UPDATE fix_jobs (failed)
// before returning 502/504.

import { Hono } from "hono";
import { ulid } from "ulid";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";

import type { Bindings } from "../index";
import { createFixJob, getApp, getBugReport, updateFixJob } from "../lib/db";
import { GitHubClient, parseRepoUrl } from "../lib/github";
import { buildAgentPrompt } from "../lib/agentPrompt";
import {
  REPO_MOUNT_PATH,
  SESSION_TIMEOUT_MS,
  getAnthropicClient,
} from "../lib/anthropic";
import { redact } from "../lib/redact";

const fixJobs = new Hono<{ Bindings: Bindings }>();

const PostBody = z.object({
  bug_report_id: z.string().min(1),
});

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

  const repoCoords = parseRepoUrl(app.github_repo_url);
  if (!repoCoords) {
    return c.json(
      {
        error: `app.github_repo_url is malformed: ${app.github_repo_url}`,
      },
      500,
    );
  }

  // 3. Generate IDs
  const fixJobId = ulid();
  const shortUlid = fixJobId.slice(-8).toLowerCase();
  const branchName = `fix/word-diff-whitespace-${shortUlid}`;

  // 4. INSERT fix_jobs + join row
  await createFixJob(
    c.env.DB,
    {
      id: fixJobId,
      app_id: app.id,
      bug_report_ids_json: JSON.stringify([bug_report_id]),
      branch_name: branchName,
      status: "running",
      started_at: Math.floor(Date.now() / 1000),
    },
    [bug_report_id],
  );

  const client = getAnthropicClient(c.env.ANTHROPIC_API_KEY);
  const github = new GitHubClient(c.env.GITHUB_DEMO_PAT);

  let sessionId: string | null = null;
  let agentReplyText = "";

  try {
    // 5. Create session with github_repository resource (PAT lives in
    //    the resource attachment, NEVER in the prompt).
    const session = await client.beta.sessions.create({
      agent: agentId,
      environment_id: environmentId,
      resources: [
        {
          type: "github_repository",
          url: app.github_repo_url,
          authorization_token: c.env.GITHUB_DEMO_PAT,
          mount_path: REPO_MOUNT_PATH,
        },
      ],
      title: `fix-job ${fixJobId}`,
      metadata: {
        project: "crowdpatch",
        role: "fix-job",
        fix_job_id: fixJobId,
      },
    });
    sessionId = session.id;

    await updateFixJob(c.env.DB, fixJobId, {
      anthropic_session_id: session.id,
    });

    // 6. STREAM-FIRST: open the SSE stream BEFORE sending the user message
    //    (per docs: events emitted before stream open are not delivered).
    const userMessage = buildAgentPrompt({
      bugReport,
      app,
      branch_name: branchName,
    });

    const stream = await client.beta.sessions.events.stream(session.id);
    await client.beta.sessions.events.send(session.id, {
      events: [
        {
          type: "user.message",
          content: [{ type: "text", text: userMessage }],
        },
      ],
    });

    // 7. Drain stream with 10-min timeout
    const timeout = new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(new Error("session timeout (10min)"));
      }, SESSION_TIMEOUT_MS);
    });

    const drain = (async () => {
      for await (const event of stream) {
        // Observability: log just the type, never raw content.
        console.log(`[fix-job ${fixJobId}] event=${event.type}`);

        if (event.type === "agent.message") {
          for (const block of event.content) {
            agentReplyText += block.text;
          }
        } else if (event.type === "session.status_idle") {
          const stopType = event.stop_reason.type;
          if (stopType === "end_turn") return;
          throw new Error(`unexpected stop_reason: ${stopType}`);
        } else if (event.type === "session.status_terminated") {
          throw new Error("session terminated unexpectedly");
        } else if (event.type === "session.error") {
          throw new Error(redact(`session error: ${event.error.message}`));
        }
      }
    })();

    await Promise.race([drain, timeout]);

    // 8. Verify branch exists on remote
    const branchExists = await github.branchExists(
      repoCoords.owner,
      repoCoords.repo,
      branchName,
    );
    if (!branchExists) {
      await updateFixJob(c.env.DB, fixJobId, {
        status: "failed",
        error_message: "agent did not push branch",
        completed_at: Math.floor(Date.now() / 1000),
      });
      return c.json({ error: "agent did not push branch" }, 502);
    }

    // 9. Open PR via Octokit
    const pr = await github.openPr({
      owner: repoCoords.owner,
      repo: repoCoords.repo,
      head: branchName,
      base: "master",
      title: `[CrowdPatch] Fix: ${bugReport.title}`,
      body: buildPrBody({
        bugReportId: bugReport.id,
        bugReportTitle: bugReport.title,
        fixJobId,
        agentReplyText,
      }),
    });

    // 10. UPDATE succeeded
    await updateFixJob(c.env.DB, fixJobId, {
      status: "succeeded",
      pr_url: pr.html_url,
      completed_at: Math.floor(Date.now() / 1000),
    });

    return c.json({
      fix_job_id: fixJobId,
      pr_url: pr.html_url,
      status: "succeeded",
    });
  } catch (err) {
    const errorMessage = redact(
      err instanceof Error ? err.message : String(err),
    );
    const isTimeout = errorMessage.includes("timeout");

    // Best-effort: archive the session if we made one
    if (sessionId) {
      try {
        await client.beta.sessions.archive(sessionId);
      } catch {
        // ignore — best-effort cleanup
      }
    }

    await updateFixJob(c.env.DB, fixJobId, {
      status: "failed",
      error_message: errorMessage,
      completed_at: Math.floor(Date.now() / 1000),
    });

    return c.json(
      { error: "fix-job failed", details: errorMessage },
      isTimeout ? 504 : 502,
    );
  }
});

interface BuildPrBodyParams {
  bugReportId: string;
  bugReportTitle: string;
  fixJobId: string;
  agentReplyText: string;
}

function buildPrBody(params: BuildPrBodyParams): string {
  const summary = params.agentReplyText
    .split("\n")
    .filter((line) => line.trim() && !line.includes("AGENT_DONE"))
    .slice(-5)
    .join("\n")
    .trim();

  return `Automated fix opened by [CrowdPatch](https://crowdpatch.ai) using Anthropic's Managed Agents.

**Bug report:** \`${params.bugReportId}\` — ${params.bugReportTitle}
**Fix job:** \`${params.fixJobId}\`

The agent investigated the failing tests, identified the root cause, applied a surgical fix, and verified the test suite passes locally before pushing.

---

<details>
<summary>Agent's final summary</summary>

\`\`\`
${summary || "(no summary captured)"}
\`\`\`

</details>

🤖 _Generated by [Claude Managed Agents](https://docs.anthropic.com/en/docs/managed-agents) via CrowdPatch._`;
}

export default fixJobs;
