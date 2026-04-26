# Point CrowdPatch at Your Own Repo

The agent prompt is repo-agnostic. To point CrowdPatch at any repo with a
test suite:

1. Pick a repo you have write access to. Plant a small bug (or use an
   existing failing test).
2. Edit `api/seeds/dev.sql`. Add an `apps` row with your repo URL plus
   `default_branch`, `setup_commands`, `test_commands`, and any
   `agent_notes` your toolchain needs (compiled outputs, mandatory
   rebuild steps, environmental fallbacks). Add one or more matching
   `bug_reports` rows.
3. Re-run `npm run db:seed:local` from the `api/` directory.
4. Visit `http://localhost:3000/demo?bug=YOUR_BUG_ID` (or
   `http://localhost:3000?bug=YOUR_BUG_ID` — same destination, the root
   path redirects to `/demo` when a `bug` query is present).
5. Watch the agent work in real time.

## The `apps` table contract

Per-repo toolchain context lives in the `apps` table (added in migration
0003):

| Column | Purpose |
|---|---|
| `default_branch` | Used both in the agent prompt and as the PR base branch. |
| `setup_commands` | Shell command(s) to install deps. Falls back to `npm install` if null. |
| `test_commands` | Shell command(s) to validate the fix. Falls back to `npm test` if null. |
| `agent_notes` | Free-form markdown for repo idiosyncrasies. Inlined verbatim into the prompt. |

## PAT scope

The default `GITHUB_DEMO_PAT` path expects a single shared PAT scoped to
the target repo. For a more flexible path — user-supplied PATs that author
the PR commits as the user, work against private repos, etc. — see
[BYO_PUSH.md](./BYO_PUSH.md).

## Worked example

The seed in `api/seeds/dev.sql` ships with `semswitch-inc/jsdiff-demo`
configured for npm-based toolchain. Use it as a template for your own
apps row.
