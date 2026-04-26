# Hackathon Notes

CrowdPatch was built for the **Built With Opus 4.7 Hackathon**
(Anthropic, April 2026), targeting the **Best Use of Managed Agents**
prize.

## What we shipped

A closed-loop bug → fix economy. A community member files a bug report
against an uploaded app. The uploader spends credits to spawn a Claude
Managed Agent (running Opus 4.6). The agent clones the repo into a
sandbox, reproduces the bug, writes the fix, validates with the repo's
own test suite, pushes a branch, and opens a real GitHub PR.

Every successful run produces a reviewable, mergeable PR — durable
artifacts you can audit after the fact.

## Demo evidence

Every run logged below is a real Pull Request CrowdPatch shipped against
[`semswitch-inc/jsdiff-demo`](https://github.com/semswitch-inc/jsdiff-demo)
during the hackathon — opened automatically by a Claude Managed Agent
(Opus 4.6) running this same codebase against the same `bug_001`.
No mocks, no fixtures.

- **Submission-day headline (2026-04-26):** [PR #14 — `[CrowdPatch] Fix: word-diff treats whitespace-only differences between tokens as real changes`](https://github.com/semswitch-inc/jsdiff-demo/pull/14) — surgical 1-line fix to `src/diff/word.ts` (`left === right` → `left.trim() === right.trim()`)
- **Auto-recovered run (2026-04-26):** [PR #13](https://github.com/semswitch-inc/jsdiff-demo/pull/13) — DO lost the upstream SSE pipe at +5min, the agent kept working and pushed the branch anyway, and `POST /api/fix-jobs/:id/recover` adopted the orphaned branch and opened the PR + recharged credits. Resilience receipt.
- **Earlier reference runs (2026-04-25):** [PR #12](https://github.com/semswitch-inc/jsdiff-demo/pull/12) · [PR #8](https://github.com/semswitch-inc/jsdiff-demo/pull/8) (clean 4.5 min) · [#11](https://github.com/semswitch-inc/jsdiff-demo/pull/11) · [#10](https://github.com/semswitch-inc/jsdiff-demo/pull/10) · [#9](https://github.com/semswitch-inc/jsdiff-demo/pull/9)
- **Full run history:** [`gh pr list --repo semswitch-inc/jsdiff-demo`](https://github.com/semswitch-inc/jsdiff-demo/pulls?q=is%3Apr+%5BCrowdPatch%5D)

The repeated whitespace-bug fixes across runs are intentional — each
demo replays the same `bug_001` to demonstrate that the agent reaches
the same correct fix every time. PRs #10 and #11 are deploy-smoke
runs against a different planted bug, proving the pipeline is
repo-agnostic.

Live demo: **[crowdpatch.dev/demo](https://crowdpatch.dev/demo)** ·
access code shared with judges via the submission form.

## Why "Best Use of Managed Agents"

CrowdPatch leans on three Managed Agents primitives that aren't easily
replicated outside the platform:

1. **`github_repository` resource** — clone, edit, commit happen inside
   Anthropic's sandbox via the SDK's repo attachment, with the PAT
   never appearing in the prompt.
2. **`events.stream()` + `events.send()`** — the SDK iterator gives us
   a clean wire format for the SSE bridge in `AgentSessionDO`. We map
   raw events to semantic `Card` payloads (`kickoff`, `explore`, `edit`,
   `commit`, `push`, `pr_opened`, `complete`).
3. **Vaults + MCP toolsets** — the BYO-push pattern (see
   [BYO_PUSH.md](./BYO_PUSH.md)) shows how user-supplied PATs can author
   the resulting PR commits via the GitHub MCP server, without ever
   passing the token through the agent prompt.

## Build-journey highlights

- **Day 1–3:** Spine. Hono + DO + SSE + D1 + Anthropic SDK iterator.
- **Day 4:** First green PR. End-to-end run from a planted bug to a
  merged-able fix.
- **Day 5 morning:** Resilience hardening — the recover path, watchdog,
  R2 evidence bundle.
- **Day 5 evening:** Opus 4.6 model swap (4.7 was occasionally returning
  classifier-driven refusals on our planted-bug demo flow). Same agent
  definition, different `model.id`.
- **Submission day (2026-04-26):** Headline PR #14 lands clean. Repo
  flips public. README de-monolith ships alongside the video.

## Reproducibility for judges

A judge with their own Anthropic API key + GitHub PAT can:

1. Clone the repo.
2. Follow [SETUP_LOCAL.md](./SETUP_LOCAL.md) (~10 min).
3. Run `npm run bootstrap:anthropic` to provision their own Managed
   Agent.
4. Click the demo button → watch a fresh PR land on
   `semswitch-inc/jsdiff-demo` (or seed their own repo per
   [CUSTOM_REPOS.md](./CUSTOM_REPOS.md)).

The website is optional. The agent + worker are the reusable core.
