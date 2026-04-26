# Run CrowdPatch Locally (10 minutes)

CrowdPatch is open source (MIT). Anyone can self-host it against their own
GitHub repo with their own Anthropic + GitHub keys. The hosted product at
[crowdpatch.dev](https://crowdpatch.dev) is a deployment of this same codebase.

## Prerequisites

- Node 20+
- An [Anthropic API key](https://console.anthropic.com/settings/keys)
- A GitHub fine-grained PAT scoped to the repo CrowdPatch will operate on
  (Contents R/W, Pull requests R/W, Issues Read)
- `wrangler` CLI (`npm i -g wrangler`)

## 1. Clone and install

```bash
git clone https://github.com/semswitch-inc/crowdpatch
cd crowdpatch
npm install
```

## 2. Configure secrets

```bash
cp api/.dev.vars.example api/.dev.vars
# Edit api/.dev.vars: paste ANTHROPIC_API_KEY and GITHUB_DEMO_PAT.
cp web/.env.local.example web/.env.local
```

## 3. Provision the local D1 database

```bash
cd api
wrangler d1 create crowdpatch-db
# Paste the printed database_id into wrangler.toml
npm run db:migrate:local
npm run db:seed:local
```

## 4. Provision the Managed Agent (one-shot, idempotent)

```bash
npm run bootstrap:anthropic
# Paste the printed ANTHROPIC_AGENT_ID and ANTHROPIC_ENVIRONMENT_ID
# into api/.dev.vars, then restart wrangler dev.
```

See [AGENT_BOOTSTRAP.md](./AGENT_BOOTSTRAP.md) for what this script does
under the hood and why we run on Opus 4.6.

## 5. Run it

```bash
# Terminal 1
cd api && npm run dev
# Terminal 2
cd web && npm run dev
```

Open [http://localhost:3000/demo](http://localhost:3000/demo) (the canonical
demo entry — the root path also works and redirects when given a `?bug=<id>`
query) and click the button. The agent will clone
[`semswitch-inc/jsdiff-demo`](https://github.com/semswitch-inc/jsdiff-demo),
fix the planted bug, and open a PR. Watch the live event log render
each step in real time.

> **Demo access code (optional in local dev)**: Mutating endpoints (POST
> `/api/apps`, `/api/bug-reports`, `/api/credits/claim`, `/api/fix-jobs`,
> `/api/fix-jobs/:id/recover`) are gated behind a shared
> `X-CrowdPatch-Demo-Code` header. The local frontend bypasses the prompt
> when `NEXT_PUBLIC_API_BASE` points at localhost, and the API bypasses the
> check when `DEMO_ACCESS_CODE` is unset AND `ENVIRONMENT=development` (the
> wrangler-dev defaults). To exercise the gate locally, set
> `DEMO_ACCESS_CODE=anything` in `api/.dev.vars`.

## Next steps

- [Try it on your own repo](./CUSTOM_REPOS.md) — point CrowdPatch at any
  repo with a test suite via the seed-database approach.
- [BYO push via Vault + GitHub MCP](./BYO_PUSH.md) — if your target is a
  private repo or you need user-authored PR commits, swap the BYO-token
  path for the Vault + MCP pattern.
- [Production deploy on Cloudflare](./SETUP_PRODUCTION.md) — full
  self-hosting against your own Cloudflare account.
- [Architecture deep-dive](./ARCHITECTURE.md) — how the Worker, Durable
  Object, and Managed Agent fit together.
