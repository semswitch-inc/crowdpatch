# CrowdPatch — web

Next.js 16 (App Router, Turbopack, static export) frontend for CrowdPatch.

Talks to the Hono+Workers API in `../api/`. Deploys to Cloudflare Pages.

## Local dev

```bash
npm install
npm run dev          # http://localhost:3000
```

Open `http://localhost:3000/demo` to demo the seeded bug. The root path
also works and redirects to `/demo` when given a `?bug=<id>` query.

`NEXT_PUBLIC_API_BASE` controls which API to hit. Defaults to local during dev (see `.env.local.example`).

The demo flow is gated behind a shared access code (sent as
`X-CrowdPatch-Demo-Code` on protected POSTs). The gate is bypassed
automatically when `NEXT_PUBLIC_API_BASE` points at localhost, so local
dev needs no extra setup. See the root README for the full story.

## Quality gate

```bash
npm run check        # typecheck + lint + test + format:check + next build
```

`next build` is part of the gate so font-fetch / Turbopack regressions surface here, not at deploy time.

## Deploy

```bash
npm run deploy       # next build + wrangler pages deploy out --project-name crowdpatch-web
```

`wrangler` is a devDependency — no separate global install needed.

## Conventions

- Read `AGENTS.md` before editing — Next 16 has breaking changes from older docs/training data.
- One component per file, colocated in `app/` for routes, `components/` for shared.
