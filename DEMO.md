# CrowdPatch Demo

> The 3-minute walkthrough submitted to the
> **[Built With Opus 4.7 Hackathon](https://cerebralvalley.ai/e/built-with-4-7-hackathon)** ·
> *Best Use of Managed Agents*.

## Watch the video

📺 **[Watch on YouTube → https://youtu.be/3z4H9OT274I](https://youtu.be/3z4H9OT274I)**

Or try the **live demo**:
**[crowdpatch.dev/demo](https://crowdpatch.dev/demo)** (access code shared
with judges via the submission form).

## What you'll see

A complete closed-loop run, end to end, in real time:

1. **Bug filed.** A community member files a bug report against
   [`semswitch-inc/jsdiff-demo`](https://github.com/semswitch-inc/jsdiff-demo) —
   "word-diff treats whitespace-only differences between tokens as real
   changes."
2. **CrowdPatch It.** The uploader (us) clicks the button. A fix-job is
   created. A Durable Object spawns a Claude Managed Agent (Opus 4.6).
3. **Live event log.** The browser opens an `EventSource` against the
   fix-job's SSE endpoint and renders semantic cards as they arrive:
   `kickoff` → `explore` → `install` → `test` (red) → `read` →
   `edit` → `test` (green) → `commit` → `push` → `pr_opened`.
4. **Real PR lands.** The PR opens on GitHub:
   [PR #14](https://github.com/semswitch-inc/jsdiff-demo/pull/14) — a
   surgical 1-line fix to `src/diff/word.ts`. Diff:
   `left === right` → `left.trim() === right.trim()`.
5. **Diff viewer.** The frontend pulls the PR diff inline so judges can
   see the fix without leaving the demo.

## Receipts

Every run in the live demo is a real PR against a public repo. No mocks.

| PR | Date | Note |
|---|---|---|
| [#14](https://github.com/semswitch-inc/jsdiff-demo/pull/14) | 2026-04-26 | Submission-day headline run |
| [#13](https://github.com/semswitch-inc/jsdiff-demo/pull/13) | 2026-04-26 | Auto-recovered run (DO died at +5min, agent kept working, recover path adopted the orphaned branch) |
| [#12](https://github.com/semswitch-inc/jsdiff-demo/pull/12) | 2026-04-25 | Earlier reference run |
| [#8](https://github.com/semswitch-inc/jsdiff-demo/pull/8) | 2026-04-25 | Clean 4.5-minute run |
| [#11](https://github.com/semswitch-inc/jsdiff-demo/pull/11) · [#10](https://github.com/semswitch-inc/jsdiff-demo/pull/10) · [#9](https://github.com/semswitch-inc/jsdiff-demo/pull/9) | 2026-04-25 | Reference runs |

Full history:
[`gh pr list --repo semswitch-inc/jsdiff-demo`](https://github.com/semswitch-inc/jsdiff-demo/pulls?q=is%3Apr+%5BCrowdPatch%5D).

## Run it yourself

The demo above is reproducible with your own Anthropic API key + GitHub
PAT in ~10 minutes. See **[docs/SETUP_LOCAL.md](./docs/SETUP_LOCAL.md)**.

To point the agent at your own repo (any repo with a test suite), see
**[docs/CUSTOM_REPOS.md](./docs/CUSTOM_REPOS.md)**.
