# Anthropic Managed Agent Bootstrap

CrowdPatch's fix-job runtime is a single Anthropic Managed Agent + a
single Environment, both provisioned once per Anthropic account.
`npm run bootstrap:anthropic` (in `api/`) creates them idempotently.

## What the script does

[`api/scripts/bootstrap-anthropic.ts`](../api/scripts/bootstrap-anthropic.ts)
is idempotent: it refuses to overwrite existing IDs in `.dev.vars`. It
also runs a tiny streaming smoke test against the freshly-created session
to confirm the SDK iterator works in Node end-to-end before exiting.

Cost is negligible — agent + environment creation are free, and the smoke
test sends one short message ("respond with OK").

## Re-running

To recreate the agent/environment, comment out the existing
`ANTHROPIC_AGENT_ID` and `ANTHROPIC_ENVIRONMENT_ID` lines in `.dev.vars`
so the script doesn't short-circuit:

```bash
cd api
npm run bootstrap:anthropic
# Paste the printed IDs back into api/.dev.vars
```

For production deploy, paste them as Worker secrets instead — see
[SETUP_PRODUCTION.md § Step 5](./SETUP_PRODUCTION.md).

## Model selection: Opus 4.6

The committed agent definition runs on **Claude Opus 4.6**. We tested
Opus 4.7 first and found that for our specific demo flow — fixing a
planted bug in a public test repo — the agent occasionally returned
classifier-driven refusals before reaching the fix step. Opus 4.6 ran
our flow cleanly. The model id is the only difference between the two
agent definitions; everything else is portable.

If you fork CrowdPatch and want to evaluate Opus 4.7 (or a future Sonnet
4.6+) on your own target repo, swap `model.id` in
`api/scripts/bootstrap-anthropic.ts` and re-run bootstrap.

The variant-routing infrastructure in `api/src/routes/fixJobs.ts` lets you
swap models per-request via `agent_variant: A|B|C|D` for A/B testing
without re-bootstrapping.

## What gets provisioned

| Resource | Purpose |
|---|---|
| **Agent** | The system prompt template + tool surface. Used to spawn sessions. |
| **Environment** | The execution sandbox config (Node, npm, git, GitHub repository attachment surface). |

Both IDs are durable — bootstrap once per account, then every fix-job
session reuses them.

## Required env vars

Before running bootstrap, `api/.dev.vars` must have:

- `ANTHROPIC_API_KEY` — your account's API key.

Bootstrap writes back:

- `ANTHROPIC_AGENT_ID`
- `ANTHROPIC_ENVIRONMENT_ID`

These two IDs are then required by the runtime (Worker / `wrangler dev`)
to spawn fix-job sessions.

## Optional: Memory store

`ANTHROPIC_MEMORY_STORE_ID` is documented in `.dev.vars.example` but not
required for the fix-job path. CrowdPatch does not use Memory in the
shipped demo.

## Smoke-testing the agent without UI

The bootstrap script's built-in smoke test validates the SDK iterator
end-to-end. For a deeper check after a code change, the simplest path is:

```bash
cd api
npm run dev
# In another terminal:
curl -N http://localhost:8787/api/fix-jobs/<id>/events
# Then trigger a fix-job from the web UI and watch the SSE stream.
```
