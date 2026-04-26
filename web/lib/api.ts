export const DEMO_CODE_HEADER = "X-CrowdPatch-Demo-Code";
export const REPO_TOKEN_HEADER = "X-CrowdPatch-Repo-Token";

/**
 * Merge the demo access-code header into a fetch RequestInit. Returns a
 * NEW init object — never mutates the input. When `code` is falsy, the
 * header is omitted (the API gate will then 403 the request, which the
 * caller surfaces back to the user).
 *
 * Use at every protected POST site:
 *   fetch(url, withDemoHeaders(code, {
 *     method: "POST",
 *     headers: { "Content-Type": "application/json" },
 *     body: ...,
 *   }))
 */
export function withDemoHeaders(
  code: string | null,
  init: RequestInit = {},
): RequestInit {
  if (!code) return init;
  const headers = new Headers(init.headers);
  headers.set(DEMO_CODE_HEADER, code);
  return { ...init, headers };
}

/**
 * Merge the bring-your-own GitHub PAT header. Composes with
 * withDemoHeaders — call this on the outside so both headers land on the
 * same Headers instance:
 *   withRepoToken(pat, withDemoHeaders(demoCode, init))
 *
 * Falsy `token` → no-op (the route handler then either succeeds on the
 * bundled demo repo, or 400s with repo_token_required for any other repo).
 * The token is the same fine-grained PAT the user pasted into the
 * FixBugButton input; it lives only in that component's state.
 */
export function withRepoToken(
  token: string | null,
  init: RequestInit = {},
): RequestInit {
  if (!token) return init;
  const headers = new Headers(init.headers);
  headers.set(REPO_TOKEN_HEADER, token);
  return { ...init, headers };
}
