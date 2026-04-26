/* eslint-disable @typescript-eslint/no-deprecated --
 * applyD1Migrations is the documented way to bring a D1 binding to a known
 * schema state inside vitest-pool-workers; SELF is its documented entrypoint.
 * See test/smoke.test.ts for the same eslint-disable rationale.
 */
import {
  applyD1Migrations,
  env as rawEnv,
  type D1Migration,
} from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { ulid } from "ulid";

import {
  CLAIM_GRANT,
  PATCH_COST,
  applyLedger,
  chargeForFixJob,
  claimDemoCredits,
  getBalance,
  ledgerEntryExists,
  refundForFixJob,
  rechargeForFixJob,
} from "../src/lib/credits";
import { createFixJob } from "../src/lib/db";

// `env` is typed `Cloudflare.Env`, which is empty in this repo because we
// don't run `wrangler types` in CI (see test/smoke.test.ts for the same
// rationale). Cast through unknown to a locally-known shape — no module
// augmentation is needed and lint stays clean.
const env = rawEnv as unknown as {
  DB: D1Database;
  TEST_MIGRATIONS: D1Migration[];
};

const TEST_USER = "test_user_credits";
const TEST_APP = "test_app_credits";

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

beforeEach(async () => {
  // Reset state — clear ledger entries for our test user, then reset balance,
  // then ensure user + app rows exist. Order matters: ledger has FK on user.
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM credit_ledger WHERE user_id = ?`).bind(
      TEST_USER,
    ),
    env.DB.prepare(
      `DELETE FROM fix_job_bug_reports WHERE fix_job_id IN
        (SELECT id FROM fix_jobs WHERE app_id = ?)`,
    ).bind(TEST_APP),
    env.DB.prepare(`DELETE FROM fix_jobs WHERE app_id = ?`).bind(TEST_APP),
    env.DB.prepare(`DELETE FROM apps WHERE id = ?`).bind(TEST_APP),
    env.DB.prepare(`DELETE FROM users WHERE id = ?`).bind(TEST_USER),
    env.DB.prepare(
      `INSERT INTO users (id, github_login, display_name, credits_balance)
         VALUES (?, ?, ?, ?)`,
    ).bind(TEST_USER, "test-credits", "Test Credits User", 100),
    env.DB.prepare(
      `INSERT INTO apps (id, owner_user_id, github_repo_url, display_name, default_branch)
         VALUES (?, ?, ?, ?, ?)`,
    ).bind(
      TEST_APP,
      TEST_USER,
      "https://github.com/test/repo",
      "Test App",
      "main",
    ),
  ]);
});

async function makeFixJob(): Promise<string> {
  const id = ulid();
  await createFixJob(
    env.DB,
    {
      id,
      app_id: TEST_APP,
      bug_report_ids_json: "[]",
      branch_name: `fix/test-${id.slice(-8).toLowerCase()}`,
      status: "pending",
      started_at: Math.floor(Date.now() / 1000),
      agent_variant: null,
      cost_credits: PATCH_COST,
      anthropic_agent_id: null,
      anthropic_environment_id: null,
      auth_mode: "demo_pat",
    },
    [],
  );
  return id;
}

describe("applyLedger", () => {
  it("inserts a new ledger row and updates balance when key is fresh", async () => {
    const result = await applyLedger(env.DB, {
      userId: TEST_USER,
      delta: -3,
      reason: "test:debit",
      relatedEntityId: null,
      idempotencyKey: "test:fresh",
    });
    expect(result.alreadyApplied).toBe(false);
    expect(result.balanceAfter).toBe(97);
    expect(result.ledgerId).not.toBeNull();
    expect(await getBalance(env.DB, TEST_USER)).toBe(97);
  });

  it("is a no-op (alreadyApplied=true, balance unchanged) on duplicate key", async () => {
    await applyLedger(env.DB, {
      userId: TEST_USER,
      delta: -3,
      reason: "test:debit",
      relatedEntityId: null,
      idempotencyKey: "test:dup",
    });
    const second = await applyLedger(env.DB, {
      userId: TEST_USER,
      delta: -3,
      reason: "test:debit",
      relatedEntityId: null,
      idempotencyKey: "test:dup",
    });
    expect(second.alreadyApplied).toBe(true);
    expect(second.balanceAfter).toBe(97);
    expect(second.ledgerId).toBeNull();

    // Confirm only ONE ledger row exists for this key.
    const count = await env.DB.prepare(
      `SELECT COUNT(*) AS c FROM credit_ledger WHERE idempotency_key = ?`,
    )
      .bind("test:dup")
      .first<{ c: number }>();
    expect(count?.c).toBe(1);
  });
});

describe("fix-job lifecycle: charge / refund / recharge", () => {
  it("chargeForFixJob then refundForFixJob nets to zero balance change", async () => {
    const start = await getBalance(env.DB, TEST_USER);
    const id = await makeFixJob();
    await chargeForFixJob(env.DB, id);
    expect(await getBalance(env.DB, TEST_USER)).toBe(start - PATCH_COST);
    await refundForFixJob(env.DB, id);
    expect(await getBalance(env.DB, TEST_USER)).toBe(start);
  });

  it("chargeForFixJob is idempotent — second call does not double-debit", async () => {
    const start = await getBalance(env.DB, TEST_USER);
    const id = await makeFixJob();
    await chargeForFixJob(env.DB, id);
    await chargeForFixJob(env.DB, id);
    expect(await getBalance(env.DB, TEST_USER)).toBe(start - PATCH_COST);
  });

  it("refundForFixJob is idempotent — second call does not double-credit", async () => {
    const start = await getBalance(env.DB, TEST_USER);
    const id = await makeFixJob();
    await chargeForFixJob(env.DB, id);
    await refundForFixJob(env.DB, id);
    await refundForFixJob(env.DB, id);
    expect(await getBalance(env.DB, TEST_USER)).toBe(start);
  });

  it("charge → refund → recharge nets to -PATCH_COST (recovery adoption path)", async () => {
    const start = await getBalance(env.DB, TEST_USER);
    const id = await makeFixJob();
    await chargeForFixJob(env.DB, id);
    await refundForFixJob(env.DB, id);
    await rechargeForFixJob(env.DB, id);
    expect(await getBalance(env.DB, TEST_USER)).toBe(start - PATCH_COST);
  });

  it("ledgerEntryExists detects refund:<id> after refundForFixJob", async () => {
    const id = await makeFixJob();
    expect(await ledgerEntryExists(env.DB, `refund:${id}`)).toBe(false);
    await chargeForFixJob(env.DB, id);
    await refundForFixJob(env.DB, id);
    expect(await ledgerEntryExists(env.DB, `refund:${id}`)).toBe(true);
  });
});

describe("claimDemoCredits", () => {
  it("first claim grants CLAIM_GRANT credits", async () => {
    const start = await getBalance(env.DB, TEST_USER);
    const result = await claimDemoCredits(env.DB, TEST_USER);
    expect(result.status).toBe("claimed");
    expect(result.granted).toBe(CLAIM_GRANT);
    expect(result.balance).toBe(start + CLAIM_GRANT);
  });

  it("second claim in the same 60s bucket is rate_limited (no balance change)", async () => {
    const fixedNow = 1_700_000_000; // both calls land in the same minute bucket
    const first = await claimDemoCredits(env.DB, TEST_USER, fixedNow);
    const second = await claimDemoCredits(env.DB, TEST_USER, fixedNow + 5);
    expect(first.status).toBe("claimed");
    expect(second.status).toBe("rate_limited");
    expect(second.granted).toBe(0);
    expect(second.balance).toBe(first.balance);
  });

  it("claim in a new 60s bucket succeeds", async () => {
    const t0 = 1_700_000_000;
    const first = await claimDemoCredits(env.DB, TEST_USER, t0);
    // +60s lands in the next bucket → fresh idempotency key.
    const second = await claimDemoCredits(env.DB, TEST_USER, t0 + 60);
    expect(first.status).toBe("claimed");
    expect(second.status).toBe("claimed");
    expect(second.balance).toBe(first.balance + CLAIM_GRANT);
  });
});
