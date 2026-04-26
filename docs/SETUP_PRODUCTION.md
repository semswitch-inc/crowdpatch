# Deploy CrowdPatch on Cloudflare

> **Optional.** The agent + worker are the reusable core. If you just want
> to run a fix-job against a repo you control, [SETUP_LOCAL.md](./SETUP_LOCAL.md)
> is enough. This guide is for full self-hosting on your own Cloudflare
> account.

CrowdPatch is open source under MIT. To deploy your own instance against
your own Cloudflare + Anthropic + GitHub credentials:

## Prerequisites

- A Cloudflare account on the **Workers Paid** plan (Durable Objects + the
  5 min CPU limit require it; ~$5/month).
- An Anthropic API key with access to Claude Opus 4.6 / Managed Agents
  beta.
- A GitHub fine-grained PAT scoped to the repo CrowdPatch will operate
  on (Contents R/W, Pull requests R/W, Issues Read).
- `wrangler` 4.x logged in to your account: `npx wrangler login`.

## 1. Provision D1

```bash
cd api
npm run db:create
# Copy the printed `database_id = "..."` value into `api/wrangler.toml`,
# REPLACING the committed placeholder. (The committed ID is the demo
# instance — your account cannot use it.)
```

## 2. Provision R2

```bash
npm run r2:create
# Bucket binding `ARTIFACTS` and bucket name `crowdpatch-artifacts` are
# already wired in wrangler.toml.
```

## 3. Apply migrations + seed (remote)

```bash
npm run db:migrate:prod
npm run db:seed:prod
# Seed inserts the demo user + apps + bug_reports for jsdiff-demo.
# Edit `api/seeds/dev.sql` first if you want to point at your own repo.
```

## 4. Set Worker secrets

```bash
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler secret put GITHUB_DEMO_PAT
# REQUIRED in production — gates mutating endpoints (apps, bug-reports,
# credits/claim, fix-jobs, fix-jobs/:id/recover) behind the
# X-CrowdPatch-Demo-Code header. Without this, those endpoints return
# 503 demo_code_not_configured (fail-closed). Pick any value and share
# it with judges/testers.
npx wrangler secret put DEMO_ACCESS_CODE
# Optional — the production wrangler.toml default is "production", which
# disables the /debug/anthropic-agents route. Override if you want it on:
npx wrangler secret put ENVIRONMENT
```

## 5. Bootstrap the Managed Agent

```bash
# bootstrap:anthropic reads api/.dev.vars (NOT Worker secrets) for the
# Anthropic key, so create that file first if you skipped local dev:
cp .dev.vars.example .dev.vars
# Edit .dev.vars and fill ANTHROPIC_API_KEY (only that line is needed
# for bootstrap; the rest can stay as REPLACE_ME).

npm run bootstrap:anthropic
# Idempotent. Prints ANTHROPIC_AGENT_ID + ANTHROPIC_ENVIRONMENT_ID.
# Set both as Worker secrets:
npx wrangler secret put ANTHROPIC_AGENT_ID
npx wrangler secret put ANTHROPIC_ENVIRONMENT_ID
```

See [AGENT_BOOTSTRAP.md](./AGENT_BOOTSTRAP.md) for the model selection
rationale and what `bootstrap:anthropic` provisions.

## 6. Configure the API host (one of two options)

- **Subdomain on workers.dev (default, no DNS setup):** comment out the
  `routes = [...]` block in `api/wrangler.toml` — your Worker will publish
  to `crowdpatch-api.<your-subdomain>.workers.dev`.
- **Custom domain:** replace the pattern in `routes = [...]` with your
  own zone (zone must already be in your CF account). Then update the
  CORS allowlist near the top of `api/src/index.ts` to include your
  frontend origin(s).

## 7. Deploy the API

```bash
cd api
npx wrangler deploy
```

## 8. Deploy the web

```bash
cd web
cp .env.production.local.example .env.production.local
# Edit .env.production.local and set NEXT_PUBLIC_API_BASE to your API
# URL (workers.dev subdomain or your custom domain).
npm run deploy
# Pushes a static export to Cloudflare Pages under project name
# `crowdpatch-web`. First deploy will prompt you to create the project.
```

**Done.** Open your Pages URL → click the demo button → the agent will
fix the seeded bug in your repo and open a PR.
