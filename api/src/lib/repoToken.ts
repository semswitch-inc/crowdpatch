// Bring-your-own GitHub PAT plumbing for custom-repo fix-jobs.
//
// The PAT travels: browser FixBugButton state → HTTPS request header →
// route handler local var → AgentSessionDO StartPayload (in-memory RPC) →
// (a) Anthropic Managed Agents github_repository.authorization_token,
// (b) Octokit instance for the post-session PR open call.
//
// The PAT is NEVER persisted to D1, R2, prompt snapshots, or logs. The
// only durable signal is fix_jobs.auth_mode='user_pat' (migration 0007),
// which lets /recover refuse to silently fall back to GITHUB_DEMO_PAT on
// BYO runs.

export const REPO_TOKEN_HEADER = "X-CrowdPatch-Repo-Token";

// GitHub fine-grained PATs always start with `github_pat_`. Length bounds
// are deliberately loose — GitHub doesn't publish an exact length spec, so
// we validate the prefix + character class and let GitHub's auth layer
// reject anything that's well-formed-but-invalid (the agent run surfaces
// that as a clean 401-from-GitHub via the existing error_event SSE path).
const REPO_TOKEN_RE = /^github_pat_[A-Za-z0-9_]{20,255}$/;

export function isValidRepoTokenFormat(token: string): boolean {
  return REPO_TOKEN_RE.test(token);
}
