# POC: Anthropic Vaults + GitHub MCP for BYO push

## Why

The shipped BYO-token slice (passing a user PAT as `github_repository.authorization_token`) cleanly clones private repos but cannot push — Anthropic's git proxy returns `401 Invalid GitHub source exchange token` for arbitrary BYO PATs. The Anthropic docs point to a different intended pattern: store the PAT in an Anthropic **Vault** bound to the GitHub MCP server URL, and let the agent push via **GitHub MCP tool calls** (which use the GitHub REST API under the hood) instead of shell `git push`.

This script is a standalone proof-of-concept. **No CrowdPatch product code is touched.** If it succeeds, a follow-up plan will design the integration.

## What it does

One `npm run poc:vault-mcp` invocation:

1. Creates an Anthropic Vault (`client.beta.vaults.create`).
2. Adds a `static_bearer` credential to the vault, bound to `https://api.githubcopilot.com/mcp/`.
3. Creates a fresh POC Managed Agent (separate from production `ANTHROPIC_AGENT_ID`) with GitHub MCP wired in via `mcp_servers` + `mcp_toolset`. Both toolsets get `permission_policy: { type: "always_allow" }` to bypass the SDK's default `always_ask` per-call approval gate.
4. Creates a session with `vault_ids: [vault.id]` and the throwaway repo mounted via `github_repository`.
5. Sends a user message asking the agent to append a line to `POC_PROOF.md` and open a PR titled `[POC] vault+mcp test` via the GitHub MCP tools.
6. Streams every event to stdout and to `.agents/evidence/byo-vault-poc/transcript.jsonl` (redacted).
7. Verifies the PR exists on GitHub via direct REST call with the same PAT.
8. Writes a one-page `summary.txt` plus `vault_id.txt`, `agent_id.txt`, `session_id.txt`, and either `pr_url.txt` (success) or `failure_reason.txt` (failure).

## Prerequisites

- `api/.dev.vars` populated with `ANTHROPIC_API_KEY` and `ANTHROPIC_ENVIRONMENT_ID` (run `npm run bootstrap:anthropic` if not).
- A throwaway public GitHub repo you control.
- A fresh fine-grained GitHub PAT scoped to that one repo. First-pass scope to try: `Contents: read+write`, `Pull requests: read+write`. The docs do NOT enumerate exact GitHub MCP scope requirements; this script will surface a 401 on the first MCP tool call if the scope is wrong.

## Usage

```bash
cd api
BYO_TEST_PAT='github_pat_…' \
BYO_TEST_REPO_URL='https://github.com/<owner>/<repo>' \
npm run poc:vault-mcp
```

The PAT is read from `process.env` (never written to `.dev.vars` or any disk file). The transcript is run through `redact()` before being saved — `github_pat_*`, `ghp_*`, `ghs_*`, `gho_*`, `ghu_*`, `ghr_*`, `sk-ant-*`, and `Bearer *` patterns are scrubbed.

## Outcome reporting

The script exits with:

- `0` if a `[POC]`-titled PR exists on the repo after the run.
- `1` if a structural error occurred (env vars missing, API call failed before session start).
- `2` if the session ran but no PR landed.

In all cases `.agents/evidence/byo-vault-poc/` contains the full evidence bundle for post-mortem.

## What success / failure tells us

- **Success:** Vaults + MCP is the right pattern for BYO push. CrowdPatch can integrate by replacing the `authorization_token` field on the resource attachment with a per-run vault create + credential add + session `vault_ids`.
- **Failure with `mcp_server_error: true`:** GitHub MCP rejected the credential — likely PAT scope or auth contract mismatch. Inspect `transcript.jsonl` for the exact error.
- **Failure with `mcp_tool_call_seen: false`:** The agent never tried an MCP tool — likely fell back to shell git despite the system prompt. Tighten the prompt or surface the `mcp_servers` list in the session metadata.
- **Failure with `mcp_tool_call_seen: true` but no PR:** MCP wiring works but a specific tool call failed. Inspect transcript for the failed tool name + error.

Per the user's standing instruction: this script does not guess. If something fails, the exact failure mode lands in `transcript.jsonl` + `failure_reason.txt`.

## Cleanup

The script does NOT delete the vault, credential, or POC agent on exit (so you can inspect them post-run). Clean up via the Anthropic dashboard or:

```ts
await client.beta.vaults.delete(vault_id);
await client.beta.agents.delete(agent_id);
```
