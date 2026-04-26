# Contributing to CrowdPatch

Welcome. CrowdPatch is MIT-licensed and PRs are welcome.

## Dev setup

Follow [docs/SETUP_LOCAL.md](./docs/SETUP_LOCAL.md). The 10-minute path
gets you a running local copy with the seeded demo bug.

## Conventions

### Branch names

Use `fix/<short-slug>` for bug fixes and feature branches authored by
contributors. Examples:

- `fix/sse-heartbeat-cadence`
- `fix/byo-pat-cleanup-on-error`

The agent itself emits PR branches under its own naming scheme — those
are produced by Managed Agents, not contributors.

### PR titles

Prefix with `[CrowdPatch]` so they're easy to filter:

```
[CrowdPatch] <imperative summary of the change>
```

This matches the format the agent uses for fix-job PRs and keeps the
human and agent PR streams visually consistent.

### Commit messages

Conventional-style prefixes (`feat:`, `fix:`, `chore:`, `docs:`,
`refactor:`, `test:`) are encouraged but not enforced. Keep the
imperative mood and write the *why* in the body when it isn't obvious
from the diff.

## The quality gate

Before opening a PR, run the full check from `api/`:

```bash
cd api
npm run check
# typecheck + lint + tests + format-check + build — same gate CI would run
```

The `web/` package has its own check that includes `next build` to
surface font-fetch / Turbopack regressions before deploy:

```bash
cd web
npm run check
```

## Where things live

- **Backend:** `api/` — Hono on Cloudflare Workers, AgentSessionDO,
  Anthropic SDK iterator, Octokit. Service-level reference in
  [`api/README.md`](./api/README.md).
- **Frontend:** `web/` — Next.js 16 (App Router, Turbopack, static
  export) on Cloudflare Pages. Read [`web/AGENTS.md`](./web/AGENTS.md)
  before editing — Next 16 has breaking changes from older docs/training
  data.
- **Docs:** `docs/` — topic-level documentation. See README's
  Documentation table for the index.
- **Internal workspace:** `.agents/` — agent planning, audit, and
  evidence artifacts. Not part of the public surface; do not reference
  from product code or public docs.

## Reporting issues

Open a GitHub issue. Include:

- What you ran (command, OS, Node version)
- What happened (full error / log excerpt)
- What you expected
- A pointer to the relevant file/line if you've localized it

For security issues, please do **not** open a public issue. Email the
maintainer at the address in the repo's GitHub profile.

## Architecture changes

For non-trivial architecture changes (new DO, new external service, new
agent capability), open an issue first describing the proposed change
and the alternatives you considered. CrowdPatch's spine is small on
purpose; we'd rather discuss before you implement.
