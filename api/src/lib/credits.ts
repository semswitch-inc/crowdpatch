// Credit ledger helpers — single source of truth for spend/refund/grant
// arithmetic against the credit_ledger and users.credits_balance tables.
//
// All mutating helpers are idempotent by construction:
//   - Each call carries a deterministic idempotency_key.
//   - applyLedger uses `INSERT ... ON CONFLICT(idempotency_key) DO NOTHING
//     RETURNING id` so a duplicate write is detected explicitly (no row
//     returned) and the cached users.credits_balance is NOT updated again.
//
// Callers only need to invoke chargeForFixJob / refundForFixJob /
// rechargeForFixJob / claimDemoCredits — they assemble the right key and
// reason and delegate to applyLedger.

import { ulid } from "ulid";

// ────────────────────────────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────────────────────────────

// Single-user demo mode (no auth this slice). Matches the seeded user in
// api/seeds/dev.sql and the owner of app_jsdiff_demo. If the seed renames
// the row, update this constant — single grep-and-replace.
export const DEMO_USER_ID = "user_uploader_hassan";

// Per-spec patch cost. Stamped on fix_jobs.cost_credits at insert time so
// refunds read the per-row value (refundForFixJob below) and pricing can
// vary later without breaking historical refunds.
export const PATCH_COST = 5;

// Per-spec claim grant.
export const CLAIM_GRANT = 25;

// Bucket size for claim rate-limiting. One claim per 60-second window per
// user — mirrors the existing fix-jobs dedup window.
const CLAIM_BUCKET_SECONDS = 60;

// ────────────────────────────────────────────────────────────────────────
// Primitive: applyLedger
// ────────────────────────────────────────────────────────────────────────

export interface ApplyLedgerInput {
  userId: string;
  delta: number;
  reason: string;
  relatedEntityId: string | null;
  idempotencyKey: string;
  metadata?: Record<string, unknown>;
}

export interface ApplyLedgerResult {
  balanceAfter: number;
  alreadyApplied: boolean;
  ledgerId: string | null;
}

/**
 * Conflict-safe ledger write.
 *
 * 1. INSERT credit_ledger row with ON CONFLICT(idempotency_key) DO NOTHING.
 *    If a row with the same key already exists, RETURNING produces no row.
 * 2. ONLY if a new row was inserted, UPDATE users.credits_balance and stamp
 *    credit_ledger.balance_after.
 *
 * This eliminates double-debit/double-credit by construction. Duplicate
 * calls return the existing balance with alreadyApplied=true.
 */
export async function applyLedger(
  db: D1Database,
  input: ApplyLedgerInput,
): Promise<ApplyLedgerResult> {
  const ledgerId = ulid();
  const metadataJson = input.metadata ? JSON.stringify(input.metadata) : null;

  const inserted = await db
    .prepare(
      `INSERT INTO credit_ledger
         (id, user_id, delta, reason, related_entity_id, idempotency_key, metadata_json)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(idempotency_key) DO NOTHING
       RETURNING id`,
    )
    .bind(
      ledgerId,
      input.userId,
      input.delta,
      input.reason,
      input.relatedEntityId,
      input.idempotencyKey,
      metadataJson,
    )
    .first<{ id: string }>();

  if (!inserted) {
    // Duplicate idempotency_key — already applied. Return cached balance.
    const balance = await getBalance(db, input.userId);
    return { balanceAfter: balance, alreadyApplied: true, ledgerId: null };
  }

  // Step 2: bump cached balance.
  const updated = await db
    .prepare(
      `UPDATE users SET credits_balance = credits_balance + ?
         WHERE id = ?
       RETURNING credits_balance`,
    )
    .bind(input.delta, input.userId)
    .first<{ credits_balance: number }>();

  if (!updated) {
    // FK violation should have prevented the insert; defensive throw.
    throw new Error(`user ${input.userId} not found after ledger insert`);
  }

  // Step 3: stamp balance_after for audit trail. Best-effort — failure here
  // doesn't invalidate the entry; it just leaves balance_after NULL.
  await db
    .prepare(`UPDATE credit_ledger SET balance_after = ? WHERE id = ?`)
    .bind(updated.credits_balance, ledgerId)
    .run();

  return {
    balanceAfter: updated.credits_balance,
    alreadyApplied: false,
    ledgerId,
  };
}

// ────────────────────────────────────────────────────────────────────────
// Read helpers
// ────────────────────────────────────────────────────────────────────────

export async function getBalance(
  db: D1Database,
  userId: string,
): Promise<number> {
  const row = await db
    .prepare(`SELECT credits_balance FROM users WHERE id = ?`)
    .bind(userId)
    .first<{ credits_balance: number }>();
  return row?.credits_balance ?? 0;
}

export interface RecentLedgerEntry {
  id: string;
  delta: number;
  reason: string;
  related_entity_id: string | null;
  balance_after: number | null;
  created_at: number;
}

export async function getRecentEntries(
  db: D1Database,
  userId: string,
  limit = 5,
): Promise<RecentLedgerEntry[]> {
  const result = await db
    .prepare(
      `SELECT id, delta, reason, related_entity_id, balance_after, created_at
         FROM credit_ledger
        WHERE user_id = ?
        ORDER BY created_at DESC, id DESC
        LIMIT ?`,
    )
    .bind(userId, limit)
    .all<RecentLedgerEntry>();
  return result.results;
}

export async function ledgerEntryExists(
  db: D1Database,
  idempotencyKey: string,
): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT 1 AS x FROM credit_ledger WHERE idempotency_key = ? LIMIT 1`,
    )
    .bind(idempotencyKey)
    .first<{ x: number }>();
  return row !== null;
}

// ────────────────────────────────────────────────────────────────────────
// Fix-job lifecycle helpers
// ────────────────────────────────────────────────────────────────────────

async function getFixJobCostContext(
  db: D1Database,
  fixJobId: string,
): Promise<{ userId: string; cost: number } | null> {
  const row = await db
    .prepare(
      `SELECT fj.cost_credits AS cost_credits, a.owner_user_id AS owner_user_id
         FROM fix_jobs fj
         JOIN apps a ON a.id = fj.app_id
        WHERE fj.id = ?`,
    )
    .bind(fixJobId)
    .first<{ cost_credits: number; owner_user_id: string }>();
  if (!row) return null;
  return { userId: row.owner_user_id, cost: row.cost_credits };
}

export async function chargeForFixJob(
  db: D1Database,
  fixJobId: string,
): Promise<ApplyLedgerResult> {
  const ctx = await getFixJobCostContext(db, fixJobId);
  if (!ctx) {
    throw new Error(`chargeForFixJob: fix_job ${fixJobId} not found`);
  }
  if (ctx.cost <= 0) {
    // Free job (e.g. cost_credits=0 row). No ledger entry; no balance change.
    return {
      balanceAfter: await getBalance(db, ctx.userId),
      alreadyApplied: true,
      ledgerId: null,
    };
  }
  return applyLedger(db, {
    userId: ctx.userId,
    delta: -ctx.cost,
    reason: "fix_job:charge",
    relatedEntityId: fixJobId,
    idempotencyKey: `charge:${fixJobId}`,
    metadata: { fix_job_id: fixJobId },
  });
}

export async function refundForFixJob(
  db: D1Database,
  fixJobId: string,
): Promise<ApplyLedgerResult> {
  const ctx = await getFixJobCostContext(db, fixJobId);
  if (!ctx) {
    throw new Error(`refundForFixJob: fix_job ${fixJobId} not found`);
  }
  if (ctx.cost <= 0) {
    // Nothing to refund.
    return {
      balanceAfter: await getBalance(db, ctx.userId),
      alreadyApplied: true,
      ledgerId: null,
    };
  }
  return applyLedger(db, {
    userId: ctx.userId,
    delta: ctx.cost,
    reason: "fix_job:refund",
    relatedEntityId: fixJobId,
    idempotencyKey: `refund:${fixJobId}`,
    metadata: { fix_job_id: fixJobId },
  });
}

export async function rechargeForFixJob(
  db: D1Database,
  fixJobId: string,
): Promise<ApplyLedgerResult> {
  const ctx = await getFixJobCostContext(db, fixJobId);
  if (!ctx) {
    throw new Error(`rechargeForFixJob: fix_job ${fixJobId} not found`);
  }
  if (ctx.cost <= 0) {
    return {
      balanceAfter: await getBalance(db, ctx.userId),
      alreadyApplied: true,
      ledgerId: null,
    };
  }
  return applyLedger(db, {
    userId: ctx.userId,
    delta: -ctx.cost,
    reason: "fix_job:recharge",
    relatedEntityId: fixJobId,
    idempotencyKey: `recharge:${fixJobId}`,
    metadata: { fix_job_id: fixJobId },
  });
}

// ────────────────────────────────────────────────────────────────────────
// Claim demo credits
// ────────────────────────────────────────────────────────────────────────

export interface ClaimResult {
  status: "claimed" | "rate_limited";
  granted: number;
  balance: number;
}

export async function claimDemoCredits(
  db: D1Database,
  userId: string,
  nowSec: number = Math.floor(Date.now() / 1000),
): Promise<ClaimResult> {
  const bucket = Math.floor(nowSec / CLAIM_BUCKET_SECONDS);
  const result = await applyLedger(db, {
    userId,
    delta: CLAIM_GRANT,
    reason: "demo:claim",
    relatedEntityId: null,
    idempotencyKey: `claim:${userId}:${String(bucket)}`,
    metadata: { source: "claim_button", bucket_seconds: CLAIM_BUCKET_SECONDS },
  });
  return {
    status: result.alreadyApplied ? "rate_limited" : "claimed",
    granted: result.alreadyApplied ? 0 : CLAIM_GRANT,
    balance: result.balanceAfter,
  };
}
