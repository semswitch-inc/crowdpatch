import type { MiddlewareHandler } from "hono";

import type { Bindings } from "../index";

export const DEMO_CODE_HEADER = "X-CrowdPatch-Demo-Code";

/**
 * Hackathon-grade gate for mutating endpoints. Compares the
 * `X-CrowdPatch-Demo-Code` request header against the `DEMO_ACCESS_CODE`
 * Worker secret. Mount on a per-path basis in `index.ts` AFTER `cors()` so
 * browsers' OPTIONS preflight is answered by the CORS middleware first.
 *
 * Failure modes:
 * - DEMO_ACCESS_CODE unset + ENVIRONMENT=development → pass through
 *   (so `wrangler dev` "just works" without setting the secret).
 * - DEMO_ACCESS_CODE unset + non-dev → 503 demo_code_not_configured
 *   (fail closed; signals a deploy-time misconfiguration vs a client auth
 *   error).
 * - Header missing → 403 missing_demo_code.
 * - Header value !== expected → 403 invalid_demo_code.
 *
 * Plain `===` comparison: the code is shared with all judges, not a
 * per-user secret, so timing attacks aren't in the threat model.
 */
export const requireDemoCode: MiddlewareHandler<{
  Bindings: Bindings;
}> = async (c, next) => {
  const expected = c.env.DEMO_ACCESS_CODE;
  if (!expected) {
    if (c.env.ENVIRONMENT === "development") {
      await next();
      return;
    }
    return c.json({ error: "demo_code_not_configured" }, 503);
  }
  const provided = c.req.header(DEMO_CODE_HEADER);
  if (!provided) return c.json({ error: "missing_demo_code" }, 403);
  if (provided !== expected) {
    return c.json({ error: "invalid_demo_code" }, 403);
  }
  await next();
  return;
};
