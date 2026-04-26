# BYO Push: Vault + GitHub MCP

> **The differentiator.** The shipped CrowdPatch demo uses a single shared
> `GITHUB_DEMO_PAT` to author PR commits. For an open-source / multi-tenant
> world, every uploader brings their own GitHub PAT and the agent must
> push as them. This doc captures the pattern that works.

## The problem

Anthropic Managed Agents accept a `github_repository` resource with an
`authorization_token` field. That token cleanly clones private repos,
**but cannot push** — Anthropic's git proxy at `api.anthropic.com`
returns `401 Invalid GitHub source exchange token` for arbitrary BYO
PATs (only Anthropic-issued exchange tokens work). The shipped
`authorization_token` path is read/clone-only.

## The pattern that works

Store the user's PAT in an Anthropic **Vault**, bind it to the GitHub
**MCP** server URL, and let the agent push via **GitHub MCP tool calls**
(which use the GitHub REST API under the hood) instead of shell
`git push`.

### Wiring

1. Create a Vault: `client.beta.vaults.create()`.
2. Add a `static_bearer` credential to the vault, bound to
   `https://api.githubcopilot.com/mcp/`.
3. Create the Managed Agent (or session) with GitHub MCP wired in via
   `mcp_servers` + `mcp_toolset`. Both toolsets get
   `permission_policy: { type: "always_allow" }` to bypass the SDK's
   default `always_ask` per-call approval gate.
4. Create the session with `vault_ids: [vault.id]` and the target repo
   mounted via `github_repository`.
5. Send a user message asking the agent to make changes and open a PR
   via the GitHub MCP tools (`create_branch`, `create_or_update_file`,
   `create_pull_request`).

## Verified end-to-end

A standalone POC ships with this repo:

- **Code:** [`api/scripts/poc-vault-github-mcp.ts`](../api/scripts/poc-vault-github-mcp.ts)
- **POC README:** [`api/scripts/poc-vault-github-mcp.README.md`](../api/scripts/poc-vault-github-mcp.README.md)
- **Run it:** `cd api && BYO_TEST_PAT='github_pat_…' BYO_TEST_REPO_URL='https://github.com/<owner>/<repo>' npm run poc:vault-mcp`

The POC creates the vault + credential + agent + session, asks it to
append a line to `POC_PROOF.md` and open a PR titled `[POC] vault+mcp test`,
streams every event to stdout, redacts the transcript, and verifies the
PR exists via direct GitHub REST. Exit codes:

- `0` — `[POC]`-titled PR landed
- `1` — structural error (missing env vars, API failure before session start)
- `2` — session ran but no PR landed

## Required PAT scope

First-pass scope to try on the user's fine-grained PAT:

- `Contents: read+write`
- `Pull requests: read+write`

Anthropic docs do not enumerate exact GitHub MCP scope requirements; the
POC will surface a 401 on the first MCP tool call if the scope is wrong.

## Secret hygiene

The POC reads the PAT from `process.env.BYO_TEST_PAT` and never writes it
to disk. The transcript is run through `redact()` before being saved —
`github_pat_*`, `ghp_*`, `ghs_*`, `gho_*`, `ghu_*`, `ghr_*`, `sk-ant-*`,
and `Bearer *` patterns are scrubbed.

## Integration into CrowdPatch product code

Not yet shipped to the main fix-job path (the demo runs against a single
shared `GITHUB_DEMO_PAT`). The integration is straightforward: replace
the `authorization_token` field on the `github_repository` attachment
with a per-run vault create + credential add + session `vault_ids`,
then drop shell `git push` instructions from the agent prompt in favor
of GitHub MCP tool descriptions. Cleanup: delete the vault + credential
in a `finally` block after the session terminates.

## Why this matters for OSS adopters

Anyone forking CrowdPatch can:

1. Run the POC against a throwaway repo with their own PAT to verify
   the pattern works in their account.
2. Lift `poc-vault-github-mcp.ts` into their own product code.
3. Skip the demo's `GITHUB_DEMO_PAT` shortcut entirely and ship a true
   per-user push path from day one.

The POC + this doc are the recipe.
