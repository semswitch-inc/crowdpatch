import { Hono } from "hono";
import { cors } from "hono/cors";
import Anthropic from "@anthropic-ai/sdk";

import apps from "./routes/apps";
import bugReports from "./routes/bugReports";
import credits from "./routes/credits";
import fixJobs from "./routes/fixJobs";
import { DEMO_CODE_HEADER, requireDemoCode } from "./lib/demoCode";

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

  // Shared demo access code. Mutating endpoints (POST /api/apps,
  // /api/bug-reports, /api/credits/claim, /api/fix-jobs, /api/fix-jobs/:id/recover)
  // require this value in the `X-CrowdPatch-Demo-Code` request header.
  // - Unset + ENVIRONMENT=development → gate passes through (local dev).
  // - Unset + non-dev → gate returns 503 demo_code_not_configured.
  // See `src/lib/demoCode.ts`.
  DEMO_ACCESS_CODE: string;

  // Managed Agent + Environment — populated by `npm run bootstrap:anthropic`
  // (one-shot script). Empty until bootstrap runs; the /api/fix-jobs route
  // returns 503 if either is unset.
  ANTHROPIC_AGENT_ID: string;
  ANTHROPIC_ENVIRONMENT_ID: string;

  // Optional A/B/C/D agent IDs for prompt-variant tournaments. Selected per
  // request via POST /api/fix-jobs `agent_variant` field. Unset → 503 if a
  // variant is requested. The legacy ANTHROPIC_AGENT_ID above is the default
  // when no variant is specified.
  ANTHROPIC_AGENT_ID_A?: string;
  ANTHROPIC_AGENT_ID_B?: string;
  ANTHROPIC_AGENT_ID_C?: string;
  ANTHROPIC_AGENT_ID_D?: string;

  // Optional pre-existing Anthropic Managed Agents memory store ID, attached
  // as a read-only `resources` entry to every session if set. Unset → no
  // attachment. The SDK shape for memory_store-as-a-session-resource is not
  // yet exposed by @anthropic-ai/sdk@^0.90.0 (verified: only github_repository
  // and file resource variants exist), so the attachment helper currently
  // warn-logs and skips when this is set. Wiring stays so the env binding +
  // intent are documented for the day the SDK ships the variant.
  ANTHROPIC_MEMORY_STORE_ID?: string;
};

const app = new Hono<{ Bindings: Bindings }>();

// CORS for browser clients hitting /api/*. Allowed origins:
//   - http://localhost:3000                    (Next.js dev server)
//   - https://crowdpatch-web.pages.dev         (this project's Pages prod URL)
//   - https://*.crowdpatch-web.pages.dev       (this project's per-deploy preview hashes)
//   - https://crowdpatch.dev                   (apex custom domain — landing + demo)
//   - https://www.crowdpatch.dev               (www custom domain — same site)
// Hostname matches use parsed URL hostname (not raw string) so a hostname
// like `crowdpatch.dev.evil.com` is not mistaken for the apex. We DO NOT
// allow `*.pages.dev` broadly — that would let any Cloudflare Pages project
// (incl. attacker-controlled ones) embed our API in a CORS-allowed page.
// Self-hosters: change `crowdpatch-web` below to your own Pages project name.
app.use(
  "/api/*",
  cors({
    origin: (origin) => {
      if (origin === "http://localhost:3000") return origin;
      try {
        const u = new URL(origin);
        if (u.protocol === "https:") {
          if (u.hostname === "crowdpatch-web.pages.dev") return origin;
          if (u.hostname.endsWith(".crowdpatch-web.pages.dev")) return origin;
          if (u.hostname === "crowdpatch.dev") return origin;
          if (u.hostname === "www.crowdpatch.dev") return origin;
        }
      } catch {
        // not a parseable URL — fall through
      }
      return null;
    },
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Content-Type", DEMO_CODE_HEADER],
  }),
);

// Demo access-code gate for mutating endpoints. Mounted AFTER cors() so
// browsers' OPTIONS preflight is answered by the CORS middleware before
// this gate runs. Read-only routes (balance, fix-job GET, SSE) stay
// public — SSE specifically must stay public because native EventSource
// cannot send custom headers.
app.use("/api/apps", requireDemoCode);
app.use("/api/bug-reports", requireDemoCode);
app.use("/api/credits/claim", requireDemoCode);
app.use("/api/fix-jobs", requireDemoCode);
app.use("/api/fix-jobs/:id/recover", requireDemoCode);

app.route("/api", apps);
app.route("/api", bugReports);
app.route("/api", credits);
app.route("/api", fixJobs);

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
// Implementation lives in ./durable_objects/agentSession.ts so the class stays
// out of the Worker entrypoint. Re-exported here because wrangler.toml's
// durable_objects.bindings looks up the class by name from the entrypoint.
export { AgentSessionDO } from "./durable_objects/agentSession";

export default app;
