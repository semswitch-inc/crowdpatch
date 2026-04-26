export const DEMO_CODE_HEADER = "X-CrowdPatch-Demo-Code";

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
