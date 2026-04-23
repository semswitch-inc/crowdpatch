import { Hono } from "hono";
import { DurableObject } from "cloudflare:workers";
import Anthropic from "@anthropic-ai/sdk";

// Bindings declared in wrangler.toml. Cloudflare injects these at runtime.
export type Bindings = {
  // Cloudflare bindings
  DB: D1Database;
  ARTIFACTS: R2Bucket;
  AGENT_SESSION_DO: DurableObjectNamespace;

  // Vars (public config, safe to commit)
  ENVIRONMENT: string;
  GITHUB_DEMO_ORG: string;
  DEMO_REPO_URL: string;

  // Secrets (set via `wrangler secret put` in prod or .dev.vars locally)
  ANTHROPIC_API_KEY: string;
  GITHUB_DEMO_PAT: string;
};

const app = new Hono<{ Bindings: Bindings }>();

app.get("/", (c) =>
  c.json({
    name: "crowdpatch-api",
    status: "healthy",
    environment: c.env.ENVIRONMENT,
    demo_repo: c.env.DEMO_REPO_URL,
  }),
);

app.get("/health", (c) => c.text("ok"));

// Dev-only: live verify @anthropic-ai/sdk works inside the Worker runtime
// AND can authenticate against the Managed Agents beta API.
//
// FAIL-SAFE GATING: this route is hidden (404) for any ENVIRONMENT value
// OTHER THAN the literal string "development" — allow-list, not deny-list.
// Deploying with ENVIRONMENT unset, misspelled, or set to "staging"/anything
// new keeps the route disabled. To enable locally, ENVIRONMENT="development"
// is already the wrangler.toml default for `wrangler dev`.
//
// Usage:
//   npm run dev                                       # start wrangler dev
//   curl http://localhost:8787/debug/anthropic-agents # hit the route
//
// Surface checks are synchronous; the list call hits api.anthropic.com.
// Requires ANTHROPIC_API_KEY in .dev.vars (locally) or
// `wrangler secret put ANTHROPIC_API_KEY` (staging).
app.get("/debug/anthropic-agents", async (c) => {
  if (c.env.ENVIRONMENT !== "development") {
    return c.notFound();
  }

  const client = new Anthropic({ apiKey: c.env.ANTHROPIC_API_KEY });

  const surface = {
    "client.beta.agents.list": typeof client.beta.agents.list,
    "client.beta.agents.create": typeof client.beta.agents.create,
    "client.beta.sessions.create": typeof client.beta.sessions.create,
    "client.beta.environments.create": typeof client.beta.environments.create,
  };

  try {
    const page = await client.beta.agents.list();
    return c.json({
      ok: true,
      environment: c.env.ENVIRONMENT,
      surface,
      list_call: {
        succeeded: true,
        agent_count: page.data.length,
        sample_ids: page.data.slice(0, 5).map((a) => a.id),
      },
    });
  } catch (err) {
    return c.json(
      {
        ok: false,
        environment: c.env.ENVIRONMENT,
        surface,
        list_call: {
          succeeded: false,
          error_type: err instanceof Error ? err.constructor.name : "Unknown",
          error_message: err instanceof Error ? err.message : String(err),
        },
      },
      500,
    );
  }
});

// One AgentSessionDO instance per live Managed Agent session.
// Day 1 stub; real implementation lands Day 2 (see .agents/plans/scaffold-plan.md §4).
export class AgentSessionDO extends DurableObject<Bindings> {
  fetch(_request: Request): Promise<Response> {
    return Promise.resolve(
      new Response("AgentSessionDO — not yet implemented", { status: 501 }),
    );
  }
}

export default app;
