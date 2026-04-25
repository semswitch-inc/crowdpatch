// GET  /api/credits/balance — current balance + last 5 ledger entries
// POST /api/credits/claim   — grant CLAIM_GRANT credits, rate-limited 1/min
//
// Single-user demo mode: no auth, no headers. The user is hardcoded to
// DEMO_USER_ID (api/src/lib/credits.ts) so the frontend doesn't need a
// session model. To support real users later, accept a userId from a
// signed cookie or auth header instead of using the constant.

import { Hono } from "hono";

import type { Bindings } from "../index";
import {
  DEMO_USER_ID,
  claimDemoCredits,
  getBalance,
  getRecentEntries,
} from "../lib/credits";

const credits = new Hono<{ Bindings: Bindings }>();

credits.get("/credits/balance", async (c) => {
  const [balance, recent] = await Promise.all([
    getBalance(c.env.DB, DEMO_USER_ID),
    getRecentEntries(c.env.DB, DEMO_USER_ID, 5),
  ]);
  return c.json({
    user_id: DEMO_USER_ID,
    balance,
    recent_entries: recent,
  });
});

credits.post("/credits/claim", async (c) => {
  const result = await claimDemoCredits(c.env.DB, DEMO_USER_ID);
  return c.json({
    user_id: DEMO_USER_ID,
    status: result.status,
    granted: result.granted,
    balance: result.balance,
  });
});

export default credits;
