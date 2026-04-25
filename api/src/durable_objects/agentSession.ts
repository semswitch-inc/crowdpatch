// AgentSessionDO — fan-out multiplexer for one Managed Agent fix-job session.
//
// One DO instance per fix_job_id (via env.AGENT_SESSION_DO.idFromName).
// Owns the upstream Anthropic event stream, persists semantic Card events
// to its SQLite, and broadcasts to N concurrent SSE subscribers (browser
// tabs, curl, etc).
//
// See .agents/plans/sequential-soaring-plum.md §"Step 2" for the full spec
// and §"SSE wire contract" for the canonical event-name list.
//
// Secrets (ANTHROPIC_API_KEY, GITHUB_DEMO_PAT) are read from this.env.
// They are NEVER serialized into the StartPayload — see plan §"DO bindings".

import { DurableObject } from "cloudflare:workers";

import type { Bindings } from "../index";
import {
  REPO_MOUNT_PATH,
  SESSION_TIMEOUT_MS,
  getAnthropicClient,
} from "../lib/anthropic";
import { buildAgentPrompt } from "../lib/agentPrompt";
import { refundForFixJob } from "../lib/credits";
import type { AppRow, BugReportRow } from "../lib/db";
import { updateFixJob } from "../lib/db";
import { type Card, mapAgentEvent } from "../lib/eventMapper";
import { GitHubClient, parseRepoUrl } from "../lib/github";
import { redact } from "../lib/redact";
import {
  HEARTBEAT_INTERVAL_MS,
  HEARTBEAT_LINE,
  formatSseEvent,
} from "../lib/sse";
import { buildAgentSummary } from "../lib/text";

export interface StartPayload {
  fix_job_id: string;
  bug_report: BugReportRow;
  app: AppRow;
  branch_name: string;
  anthropic_agent_id: string;
  anthropic_environment_id: string;
}

export class AgentSessionDO extends DurableObject<Bindings> {
  private subscribers = new Set<ReadableStreamDefaultController<Uint8Array>>();
  private heartbeat: number | null = null;
  private encoder = new TextEncoder();

  constructor(ctx: DurableObjectState, env: Bindings) {
    super(ctx, env);
    // Idempotent schema bootstrap on first instantiation. DO SQLite is
    // declared via [[migrations]].new_sqlite_classes in wrangler.toml.
    ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS events(
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        ts INTEGER NOT NULL,
        kind TEXT NOT NULL,
        payload_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS state(
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
  }

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/start") {
      const payload = await request.json<StartPayload>();
      return this.handleStart(payload);
    }
    if (request.method === "GET" && url.pathname === "/subscribe") {
      return this.handleSubscribe();
    }
    return new Response("not found", { status: 404 });
  }

  private handleStart(payload: StartPayload): Response {
    // Idempotent against double-start
    const started = this.ctx.storage.sql
      .exec("SELECT value FROM state WHERE key='started'")
      .toArray();
    if (started.length > 0) {
      return Response.json({ status: "already_started" }, { status: 202 });
    }
    this.ctx.storage.sql.exec(
      "INSERT INTO state(key,value) VALUES('started', ?)",
      String(Date.now()),
    );
    this.persistEvent({
      kind: "kickoff",
      label: "Starting fresh sandbox",
      ts: Date.now(),
    });

    // Run agent without blocking the response. waitUntil keeps the DO
    // instance alive until runAgent settles.
    this.ctx.waitUntil(this.runAgent(payload));
    return Response.json({ status: "started" }, { status: 202 });
  }

  private handleSubscribe(): Response {
    const stream = new ReadableStream<Uint8Array>({
      start: (controller) => {
        // Replay history first
        const rows = this.ctx.storage.sql
          .exec<{
            kind: string;
            payload_json: string;
          }>("SELECT kind, payload_json FROM events ORDER BY seq ASC")
          .toArray();
        for (const row of rows) {
          controller.enqueue(
            this.encoder.encode(formatSseEvent(row.kind, row.payload_json)),
          );
        }
        // If session is already complete, close after replay — no live stream.
        const complete = this.ctx.storage.sql
          .exec("SELECT value FROM state WHERE key='complete'")
          .toArray();
        if (complete.length > 0) {
          try {
            controller.close();
          } catch {
            /* already closed */
          }
          return;
        }
        // Attach as live subscriber
        this.subscribers.add(controller);
        this.ensureHeartbeat();
      },
      cancel: () => {
        // Subscriber disconnected; controller will be cleaned next broadcast.
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  }

  private persistEvent(card: Card): void {
    const payload = JSON.stringify(card);
    this.ctx.storage.sql.exec(
      "INSERT INTO events(ts, kind, payload_json) VALUES (?, ?, ?)",
      card.ts,
      card.kind,
      payload,
    );
    this.broadcast(card.kind, payload);
  }

  private broadcast(eventName: string, payload: string): void {
    const chunk = this.encoder.encode(formatSseEvent(eventName, payload));
    const dead: ReadableStreamDefaultController<Uint8Array>[] = [];
    for (const sub of this.subscribers) {
      try {
        sub.enqueue(chunk);
      } catch {
        dead.push(sub);
      }
    }
    for (const d of dead) this.subscribers.delete(d);
  }

  private ensureHeartbeat(): void {
    if (this.heartbeat !== null) return;
    const ping = this.encoder.encode(HEARTBEAT_LINE);
    this.heartbeat = setInterval(() => {
      const dead: ReadableStreamDefaultController<Uint8Array>[] = [];
      for (const sub of this.subscribers) {
        try {
          sub.enqueue(ping);
        } catch {
          dead.push(sub);
        }
      }
      for (const d of dead) this.subscribers.delete(d);
      // Stop heartbeat once no subscribers remain — DO can hibernate freely.
      if (this.subscribers.size === 0 && this.heartbeat !== null) {
        clearInterval(this.heartbeat);
        this.heartbeat = null;
      }
    }, HEARTBEAT_INTERVAL_MS) as unknown as number;
  }

  private markComplete(): void {
    this.ctx.storage.sql.exec(
      "INSERT OR REPLACE INTO state(key,value) VALUES('complete', ?)",
      String(Date.now()),
    );
    for (const sub of this.subscribers) {
      try {
        sub.close();
      } catch {
        /* already closed */
      }
    }
    this.subscribers.clear();
    if (this.heartbeat !== null) {
      clearInterval(this.heartbeat);
      this.heartbeat = null;
    }
  }

  private async runAgent(payload: StartPayload): Promise<void> {
    // started_at was set at POST insert time (Step 3 §6); just bump status.
    await updateFixJob(this.env.DB, payload.fix_job_id, { status: "running" });

    const repoCoords = parseRepoUrl(payload.app.github_repo_url);
    if (!repoCoords) {
      const msg = `malformed github_repo_url: ${payload.app.github_repo_url}`;
      // Refund BEFORE the SSE error_event broadcasts so a UI refetch
      // triggered by the terminal event sees the post-refund balance.
      // refundForFixJob is idempotent (key=refund:<id>) — safe even if a
      // later /recover call also tries to refund.
      await safeRefund(this.env.DB, payload.fix_job_id);
      this.persistEvent({
        kind: "error_event",
        label: msg,
        ended_reason: "agent_error",
        ts: Date.now(),
      });
      await updateFixJob(this.env.DB, payload.fix_job_id, {
        status: "failed",
        error_message: msg,
        ended_reason: "agent_error",
        completed_at: nowSec(),
      });
      this.markComplete();
      return;
    }

    const client = getAnthropicClient(this.env.ANTHROPIC_API_KEY);
    const github = new GitHubClient(this.env.GITHUB_DEMO_PAT);
    let sessionId: string | null = null;
    let agentReplyText = "";

    // Captured from the FIRST span.model_request_end event in the session
    // stream — see migration 0004 for why first-only. Flushed to D1 in the
    // finally below so it persists across success, failure, and timeout.
    //
    // NOTE: firstUsage is mutated inside the inner `drain` async closure,
    // which TS treats as opaque for control-flow narrowing. After the
    // await on Promise.race, TS believes firstUsage is still null and
    // narrows `if (firstUsage !== null)` to `never`. The `as FirstUsage |
    // null` cast in the finally block widens past that limitation.
    type FirstUsage = {
      cache_creation_input_tokens: number | null;
      cache_read_input_tokens: number | null;
      input_tokens: number | null;
      output_tokens: number | null;
    };
    let firstUsage: FirstUsage | null = null;

    try {
      // Open Managed Agent session with the repo mounted via authorization_token.
      // The PAT lives ONLY in the resource attachment; never in the prompt.
      const session = await client.beta.sessions.create({
        agent: payload.anthropic_agent_id,
        environment_id: payload.anthropic_environment_id,
        resources: [
          {
            type: "github_repository",
            url: payload.app.github_repo_url,
            authorization_token: this.env.GITHUB_DEMO_PAT,
            mount_path: REPO_MOUNT_PATH,
          },
        ],
        title: `fix-job ${payload.fix_job_id}`,
        metadata: {
          project: "crowdpatch",
          role: "fix-job",
          fix_job_id: payload.fix_job_id,
        },
      });
      sessionId = session.id;
      await updateFixJob(this.env.DB, payload.fix_job_id, {
        anthropic_session_id: session.id,
      });

      const userMessage = buildAgentPrompt({
        bugReport: payload.bug_report,
        app: payload.app,
        branch_name: payload.branch_name,
      });

      // STREAM-FIRST ordering: open events.stream() BEFORE events.send()
      // (events emitted before stream open are not delivered).
      const stream = await client.beta.sessions.events.stream(session.id);
      await client.beta.sessions.events.send(session.id, {
        events: [
          {
            type: "user.message",
            content: [{ type: "text", text: userMessage }],
          },
        ],
      });

      const timeout = new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(new Error("session timeout (10min)"));
        }, SESSION_TIMEOUT_MS);
      });

      const drain = (async () => {
        for await (const event of stream) {
          // Map to a semantic Card if the event has a known shape.
          const card = mapAgentEvent(event);
          if (card) {
            if (card.kind === "thought") {
              agentReplyText += card.text + "\n";
            }
            this.persistEvent(card);
          }

          // Lifecycle handling — minimal typing, the SDK union is wide.
          const e = event as {
            type?: string;
            stop_reason?: { type?: string };
            error?: { message?: string };
            model_usage?: {
              cache_creation_input_tokens?: number;
              cache_read_input_tokens?: number;
              input_tokens?: number;
              output_tokens?: number;
            };
          };
          // Capture FIRST model_usage we see. Subsequent requests include
          // conversation history and aren't comparable across runs.
          if (firstUsage === null && e.type === "span.model_request_end") {
            const u = e.model_usage;
            if (u && typeof u === "object") {
              firstUsage = {
                cache_creation_input_tokens:
                  typeof u.cache_creation_input_tokens === "number"
                    ? u.cache_creation_input_tokens
                    : null,
                cache_read_input_tokens:
                  typeof u.cache_read_input_tokens === "number"
                    ? u.cache_read_input_tokens
                    : null,
                input_tokens:
                  typeof u.input_tokens === "number" ? u.input_tokens : null,
                output_tokens:
                  typeof u.output_tokens === "number" ? u.output_tokens : null,
              };
            }
          }
          if (e.type === "session.status_idle") {
            const stopType = e.stop_reason?.type ?? "unknown";
            if (stopType === "end_turn") return;
            throw new Error(`unexpected stop_reason: ${stopType}`);
          } else if (e.type === "session.status_terminated") {
            throw new Error("session terminated unexpectedly");
          } else if (e.type === "session.error") {
            throw new Error(
              redact(`session error: ${e.error?.message ?? "unknown"}`),
            );
          }
        }
      })();

      await Promise.race([drain, timeout]);

      // Branch precondition — the agent must have pushed.
      const exists = await github.branchExists(
        repoCoords.owner,
        repoCoords.repo,
        payload.branch_name,
      );
      if (!exists) {
        await safeRefund(this.env.DB, payload.fix_job_id);
        this.persistEvent({
          kind: "error_event",
          label: "agent did not push branch",
          ended_reason: "agent_no_push",
          ts: Date.now(),
        });
        await updateFixJob(this.env.DB, payload.fix_job_id, {
          status: "failed",
          error_message: "agent did not push branch",
          ended_reason: "agent_no_push",
          completed_at: nowSec(),
        });
        this.markComplete();
        return;
      }

      // Open PR. Base branch comes from the per-app `default_branch` column
      // (Day 3 — see migration 0003) so self-host repos using `main` don't
      // 422 against a hardcoded `master`.
      const pr = await github.openPr({
        owner: repoCoords.owner,
        repo: repoCoords.repo,
        head: payload.branch_name,
        base: payload.app.default_branch,
        title: `[CrowdPatch] Fix: ${payload.bug_report.title}`,
        body: buildPrBody({
          bugReport: payload.bug_report,
          fixJobId: payload.fix_job_id,
          agentReplyText,
        }),
      });

      // Capture commit SHA — best-effort; don't fail the job if unreadable.
      let commitSha: string | null = null;
      try {
        commitSha = await github.getBranchHeadSha(
          repoCoords.owner,
          repoCoords.repo,
          payload.branch_name,
        );
      } catch {
        // best-effort; commit_sha stays null
      }

      this.persistEvent({
        kind: "pr_opened",
        label: `PR #${String(pr.number)} opened`,
        pr_url: pr.html_url,
        pr_number: pr.number,
        ts: Date.now(),
      });

      this.persistEvent({
        kind: "complete",
        label: "Done — fix pushed and PR opened",
        pr_url: pr.html_url,
        fix_job_id: payload.fix_job_id,
        ended_reason: "success",
        summary_text: buildAgentSummary(agentReplyText, { maxChars: 600 }),
        ts: Date.now(),
      });

      await updateFixJob(this.env.DB, payload.fix_job_id, {
        status: "succeeded",
        pr_url: pr.html_url,
        commit_sha: commitSha,
        result_summary_json: JSON.stringify({
          agent_reply_tail: agentReplyText.slice(-2000),
          pr_number: pr.number,
        }),
        ended_reason: "success",
        completed_at: nowSec(),
      });

      this.markComplete();
    } catch (err) {
      const msg = redact(err instanceof Error ? err.message : String(err));
      const ended_reason = msg.includes("timeout") ? "timeout" : "agent_error";

      // Best-effort: archive the session if we made one
      if (sessionId) {
        try {
          await client.beta.sessions.archive(sessionId);
        } catch {
          // best-effort cleanup
        }
      }

      await safeRefund(this.env.DB, payload.fix_job_id);

      this.persistEvent({
        kind: "error_event",
        label: msg,
        ended_reason,
        ts: Date.now(),
      });

      await updateFixJob(this.env.DB, payload.fix_job_id, {
        status: "failed",
        error_message: msg,
        ended_reason,
        completed_at: nowSec(),
      });

      this.markComplete();
    } finally {
      // Persist usage stats from the first model_request_end on every
      // terminal path (success, agent_no_push, timeout, agent_error).
      // Best-effort — don't let a usage-write failure mask the real outcome.
      // See FirstUsage type-alias declaration above for why the cast is here.
      const captured = firstUsage as FirstUsage | null;
      if (captured !== null) {
        try {
          await updateFixJob(this.env.DB, payload.fix_job_id, {
            first_cache_creation_input_tokens:
              captured.cache_creation_input_tokens,
            first_cache_read_input_tokens: captured.cache_read_input_tokens,
            first_input_tokens: captured.input_tokens,
            first_output_tokens: captured.output_tokens,
          });
        } catch {
          // best-effort; usage stats are diagnostic, not load-bearing
        }
      }
    }
  }
}

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

// Best-effort refund wrapper. Refund failures must not mask the underlying
// terminal-failure path or block updateFixJob — a refund miss is recoverable
// (later /recover sweep can re-detect by absence of refund:<id>), a missed
// updateFixJob would orphan the row.
async function safeRefund(db: D1Database, fixJobId: string): Promise<void> {
  try {
    await refundForFixJob(db, fixJobId);
  } catch (err) {
    console.warn(
      `[agentSession] refund failed for ${fixJobId}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

interface BuildPrBodyParams {
  bugReport: BugReportRow;
  fixJobId: string;
  agentReplyText: string;
}

const PR_BODY_DESCRIPTION_CAP = 400;

function buildPrBody(params: BuildPrBodyParams): string {
  const summary = buildAgentSummary(params.agentReplyText);
  const description =
    params.bugReport.description.length > PR_BODY_DESCRIPTION_CAP
      ? `${params.bugReport.description.slice(0, PR_BODY_DESCRIPTION_CAP)}…`
      : params.bugReport.description;
  const descriptionBlock = description
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");

  return `Automated fix opened by [CrowdPatch](https://crowdpatch.ai) using Anthropic's Managed Agents.

**Submitted report**
- Reporter: ${params.bugReport.reporter_name}
- Severity: ${params.bugReport.severity}
- Title: ${params.bugReport.title}

${descriptionBlock}

**Bug report id:** \`${params.bugReport.id}\`
**Fix job:** \`${params.fixJobId}\`

---

The agent investigated the failing tests, identified the root cause, applied a surgical fix, and verified the test suite passes locally before pushing.

<details>
<summary>Agent's final summary</summary>

\`\`\`
${summary || "(no summary captured)"}
\`\`\`

</details>

🤖 _Generated by [Claude Managed Agents](https://docs.anthropic.com/en/docs/managed-agents) via CrowdPatch._`;
}
