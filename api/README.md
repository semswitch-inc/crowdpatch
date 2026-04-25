# crowdpatch-api

The CrowdPatch backend. Hono on Cloudflare Workers, orchestrating Anthropic
Managed Agents to investigate bug reports, write fixes, and open pull
requests.

For the project pitch and one-shot setup walkthrough, see the
[top-level README](../README.md). This file documents the API service
itself: architecture, scripts, and how to wire up the Anthropic + GitHub
credentials needed to run it locally.

## Stack

- **Hono** — HTTP routing on Cloudflare Workers (`src/index.ts`).
- **Durable Objects** — `AgentSessionDO` owns one Anthropic agent session
  per fix-job, persists semantic events to its own SQLite, and fans out
  Server-Sent Events to N concurrent browser subscribers
  (`src/durable_objects/agentSession.ts`).
- **D1** — relational store for users, apps, bug reports, fix-jobs, and
  the credit ledger. Migrations in `migrations/`, dev seed in
  `seeds/dev.sql`, helpers in `src/lib/db.ts`.
- **R2** — durable per-fix-job evidence bundle. Every run writes
  `submitted-bug.json`, `agent-prompt.txt`, `run-summary.json`,
  `pr-metadata.json`, and (when populated) `agent-reply-tail.txt` under
  the `fix-jobs/<fix_job_id>/` prefix. A manifest (R2 keys, content
  types, byte sizes) is persisted on the row and surfaced via
  `GET /api/fix-jobs/:id`. Writes are best-effort and isolated per file
  — an R2 outage never blocks the run, the PR, or the SSE terminal
  event. See `src/lib/artifacts.ts`.
- **Anthropic Managed Agents SDK** — `@anthropic-ai/sdk` beta surface,
  `client.beta.sessions.create / events.stream / events.send`. The agent
  runs against a `github_repository` resource; the PAT is attached to the
  resource, never to the prompt. Default runtime model is **Opus 4.6**
  (selected for reliable patch execution; the variant-routing infrastructure
  in `src/routes/fixJobs.ts` lets you swap models per-request via
  `agent_variant: A|B|C|D` for A/B testing).
- **Octokit** — used inside the DO to verify the agent pushed its branch
  and to open the resulting pull request (`src/lib/github.ts`).

## Local development

You will need:

- Node 20+
- `wrangler` 4.x in `PATH` (`npm i -g wrangler`)
- An Anthropic API key
- A GitHub fine-grained PAT scoped to the repo CrowdPatch will operate on

```bash
cp .dev.vars.example .dev.vars
# Edit .dev.vars and fill in ANTHROPIC_API_KEY + GITHUB_DEMO_PAT.

npm install                 # if you haven't already from the repo root
npm run db:migrate:local    # apply migrations to a fresh local D1
npm run db:seed:local       # populate users, apps, bug_reports
npm run bootstrap:anthropic # one-shot: provisions the Managed Agent
                            # + Environment, prints IDs to paste into
                            # .dev.vars (ANTHROPIC_AGENT_ID +
                            # ANTHROPIC_ENVIRONMENT_ID).

npm run dev                 # wrangler dev on http://localhost:8787
```

`npm run check` runs typecheck + lint + tests + format-check + build —
the same gate CI would run.

## Bootstrap script (`npm run bootstrap:anthropic`)

`scripts/bootstrap-anthropic.ts` is idempotent: it refuses to overwrite
existing IDs in `.dev.vars`. It also runs a tiny streaming smoke test
against the freshly-created session to confirm the SDK iterator works in
Node end-to-end before exiting.

Cost is negligible — agent + environment creation are free, and the smoke
test sends one short message ("respond with OK"). Re-run it any time you
need to recreate the agent/environment (uncomment the existing
`ANTHROPIC_AGENT_ID` / `ANTHROPIC_ENVIRONMENT_ID` lines in `.dev.vars` so
the script doesn't short-circuit).

## Database commands

| Script                     | Effect                                               |
| -------------------------- | ---------------------------------------------------- |
| `npm run db:migrate:local` | Apply pending migrations to the local D1.            |
| `npm run db:migrate:prod`  | Same, against the remote production D1.              |
| `npm run db:seed:local`    | Re-seed local D1 (idempotent — `INSERT OR REPLACE`). |
| `npm run db:seed:prod`     | Same, against remote.                                |

To reset local D1 entirely: `rm -rf .wrangler/state/v3/d1` and re-run
`db:migrate:local` + `db:seed:local`.

## Routes

| Method | Path                        | Purpose                                                                                                                                 |
| ------ | --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `GET`  | `/health`                   | Liveness probe.                                                                                                                         |
| `GET`  | `/`                         | Service banner + the `DEMO_REPO_URL` it's currently pointed at.                                                                         |
| `POST` | `/api/apps`                 | Register a new app (repo URL, default branch, optional setup/test commands, agent notes).                                               |
| `POST` | `/api/bug-reports`          | File a new bug report against an app. Returns the bug ID for deep-linking into `/demo`.                                                 |
| `GET`  | `/api/credits/balance`      | Return the requester's credit balance (single-user demo: scopes by `user_uploader_hassan`).                                             |
| `POST` | `/api/credits/claim`        | Mint the daily allowance for the requester. Idempotent per UTC day.                                                                     |
| `POST` | `/api/fix-jobs`             | Validate, dedupe (60s window), insert, hand off to `AgentSessionDO`. Returns `202 { fix_job_id, stream_url }`.                          |
| `GET`  | `/api/fix-jobs/:id`         | Full row: status, cost, PR URL, token totals, run-artifact manifest (R2 keys + bytes), prompt snapshot reference.                       |
| `GET`  | `/api/fix-jobs/:id/events`  | SSE stream of semantic agent events. Replays history from DO SQLite on (re)connect, then streams live. Browser opens via `EventSource`. |
| `POST` | `/api/fix-jobs/:id/recover` | Manual escape hatch: detect late branch pushes, adopt as success (refunds credit), or mark `agent_no_push` after the cutoff window.     |

## SSE wire contract

`AgentSessionDO` emits one of these `event:` names per message — every
event carries a JSON payload matching `src/lib/eventMapper.ts` `Card`:

- Progress: `kickoff`, `explore`, `install`, `test`, `read`, `edit`,
  `commit`, `push`, `thought`, `pr_opened`
- Terminal: `complete` (success — payload includes `pr_url`) or
  `error_event` (terminal failure — payload includes `ended_reason`)
- Comment lines `:heartbeat\n\n` every 15s to keep proxies/browsers from
  idling out

The browser closes the EventSource on either terminal event. Native
EventSource `error` events (transport-level network blips) are
auto-reconnected by the browser and are NOT terminal.

## Pointing CrowdPatch at your own repo

The agent prompt is repo-agnostic. Per-repo toolchain context lives in
the `apps` table (added in migration 0003):

| Column           | Purpose                                                                                                                                            |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `default_branch` | Used both in the agent prompt and as the PR base branch.                                                                                           |
| `setup_commands` | Shell command(s) to install deps. Falls back to `npm install` if null.                                                                             |
| `test_commands`  | Shell command(s) to validate the fix. Falls back to `npm test` if null.                                                                            |
| `agent_notes`    | Free-form markdown for repo idiosyncrasies (compiled outputs, mandatory rebuild steps, environmental fallbacks). Inlined verbatim into the prompt. |

To add your own repo: edit `seeds/dev.sql` with a new `apps` row and one
or more matching `bug_reports` rows, then re-run `npm run db:seed:local`.
The frontend reads `?bug=<id>` from the URL, so you can demo any seeded
bug at `http://localhost:3000?bug=YOUR_BUG_ID`.

## Layout

```
api/
├── migrations/                  # numbered .sql files; cumulative
├── seeds/                       # dev seed data
├── scripts/                     # bootstrap-anthropic, future utilities
├── src/
│   ├── index.ts                 # Worker entry: Hono app + CORS + DO export
│   ├── routes/
│   │   └── fixJobs.ts           # POST + GET /api/fix-jobs/* handlers
│   ├── durable_objects/
│   │   └── agentSession.ts      # AgentSessionDO — multiplexer + persister
│   ├── lib/
│   │   ├── db.ts                # D1 helpers + row types
│   │   ├── github.ts            # Octokit wrapper + branch/PR helpers
│   │   ├── anthropic.ts         # SDK setup + session helpers
│   │   ├── agentPrompt.ts       # buildAgentPrompt(app, bugReport, branch)
│   │   ├── eventMapper.ts       # Anthropic event → semantic Card
│   │   ├── sse.ts               # formatSseEvent + heartbeat constants
│   │   ├── redact.ts            # secret-scrubbing for agent text
│   │   └── text.ts              # slugify + tiny string helpers
│   └── …
└── wrangler.toml                # bindings: DB, AGENT_SESSION_DO, ARTIFACTS
```

## License

MIT — see [the repo root LICENSE](../LICENSE).
