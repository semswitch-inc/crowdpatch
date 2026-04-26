# CrowdPatch

**Community-sourced bugs. AI-shipped fixes.** Powered by Claude Managed
Agents on Opus 4.6 — every run lands as a real GitHub PR.

> Built for the **[Built With Opus 4.7 Hackathon](https://cerebralvalley.ai/e/built-with-4-7-hackathon)** ·
> targeting **Best Use of Managed Agents**.

A developer ecosystem where bug reports become merged PRs — manually
invoked, or autonomously and asynchronously, while you sleep.

## The loop

1. **Upload** — Developer links a GitHub repo to CrowdPatch.
2. **Report** — Community members test apps, file bug reports, earn credits.
3. **CrowdPatch it** — Uploader spends credits to spawn a Claude Managed
   Agent. The agent enters a sandbox, diagnoses, writes the fix, runs the
   tests, opens a PR.
4. **Ship** — Developer reviews, merges. App is permanently better.

The crowd finds it. Claude fixes it. You ship it.

## Why it matters

Every other AI coding tool requires the developer to be in the loop —
babysitting suggestions, approving diffs line by line. CrowdPatch
inverts the model. The crowd becomes QA. The agent becomes the engineer.
The developer becomes the curator.

## Demo

- **3-min walkthrough:** **[Watch on YouTube → https://youtu.be/3z4H9OT274I](https://youtu.be/3z4H9OT274I)** · or see [DEMO.md](./DEMO.md) for the full walkthrough
- **Live demo:** [crowdpatch.dev/demo](https://crowdpatch.dev/demo) ·
  access code shared with judges via the submission form
- **Headline PR (submission day):** [`[CrowdPatch] Fix: word-diff treats whitespace-only differences as real changes`](https://github.com/semswitch-inc/jsdiff-demo/pull/14)
- **Full PR history:** [all `[CrowdPatch]` PRs on `semswitch-inc/jsdiff-demo`](https://github.com/semswitch-inc/jsdiff-demo/pulls?q=is%3Apr+%5BCrowdPatch%5D)

Every run is a real PR against a public test repo — no mocks, no fixtures.

## Architecture

```
Browser ──POST /api/fix-jobs──▶ Worker (Hono) ──▶ AgentSessionDO ──▶ Claude Managed Agent
   ▲                                                  │                       │
   └────── SSE: kickoff, edit, commit, pr_opened ◀────┘                       ▼
                                                                            GitHub
```

One Durable Object per fix-job. The DO owns the Anthropic event
iterator, persists semantic events to its SQLite for replay-on-reconnect,
and fans out Server-Sent Events to N concurrent browser subscribers.

Deep dive: [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md).

## Quick start

```bash
git clone https://github.com/semswitch-inc/crowdpatch
cd crowdpatch && npm install
cp api/.dev.vars.example api/.dev.vars   # paste your Anthropic + GitHub keys
cd api && npm run dev                    # → http://localhost:8787
# In a second terminal:
cd web && npm run dev                    # → http://localhost:3000/demo
```

For the full 10-minute setup (D1 provisioning, agent bootstrap, demo
gate), see **[docs/SETUP_LOCAL.md](./docs/SETUP_LOCAL.md)**.

## Project structure

```
CrowdPatch/
├── api/                  Hono on Cloudflare Workers — fix-job orchestrator
│   ├── src/              Worker entry, routes, DO, lib helpers
│   ├── scripts/          Anthropic agent bootstrap + Vault+MCP POC
│   ├── migrations/       D1 SQL migrations
│   └── seeds/            dev seed (apps + bug_reports)
├── web/                  Next.js 16 frontend (Cloudflare Pages)
├── docs/                 Topic-level documentation (see below)
├── DEMO.md               3-min video + walkthrough
├── CONTRIBUTING.md       Branch + PR conventions, dev gate
└── LICENSE               MIT
```

## Documentation

| Doc | What's in it |
|---|---|
| [docs/SETUP_LOCAL.md](./docs/SETUP_LOCAL.md) | Run it yourself in 10 minutes |
| [docs/SETUP_PRODUCTION.md](./docs/SETUP_PRODUCTION.md) | Self-host on Cloudflare (8 steps) |
| [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) | Worker, Durable Object, SSE wire contract, recover path |
| [docs/BYO_PUSH.md](./docs/BYO_PUSH.md) | Vault + GitHub MCP for user-supplied PATs |
| [docs/AGENT_BOOTSTRAP.md](./docs/AGENT_BOOTSTRAP.md) | Managed Agent provisioning, Opus 4.6 rationale |
| [docs/CUSTOM_REPOS.md](./docs/CUSTOM_REPOS.md) | Point CrowdPatch at any repo with a test suite |
| [docs/HACKATHON.md](./docs/HACKATHON.md) | Demo evidence, prize positioning, build journey |
| [api/README.md](./api/README.md) | Backend service reference: routes, demo gate, layout |
| [web/README.md](./web/README.md) | Frontend dev notes (Next.js 16) |

## For other builders

The **agent + worker spine is the reusable core** — clone the repo, plug
in your own Anthropic + GitHub keys, point it at any repo with a test
suite (see [CUSTOM_REPOS.md](./docs/CUSTOM_REPOS.md)), and you have a
working fix-job pipeline.

The website is optional. If you want it, follow [SETUP_PRODUCTION.md](./docs/SETUP_PRODUCTION.md).
If you don't, lift `api/` (and the BYO-push POC at
`api/scripts/poc-vault-github-mcp.ts`) into your own product.

The standout pattern worth stealing on its own:
[BYO_PUSH.md](./docs/BYO_PUSH.md) — how to wire user-supplied GitHub PATs
into a Managed Agent via Vaults + GitHub MCP, since the
`github_repository.authorization_token` path is read-only.

## Hosted version

A managed deployment at [crowdpatch.dev](https://crowdpatch.dev) runs
this same codebase. Until the SaaS layer (auth, billing, multi-tenant
projects) lands, self-hosting via [SETUP_LOCAL.md](./docs/SETUP_LOCAL.md)
is the canonical way to point CrowdPatch at your own repos.

## License

MIT — see [LICENSE](./LICENSE). All dependencies are OSS-compatible.

---

~ [crowdpatch.dev](https://crowdpatch.dev) · Just CrowdPatch it. ~
