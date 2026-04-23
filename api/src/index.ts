import { Hono } from "hono";
import { DurableObject } from "cloudflare:workers";

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
