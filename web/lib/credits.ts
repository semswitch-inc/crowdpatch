"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { withDemoHeaders } from "@/lib/api";

// Wire shapes mirror api/src/routes/credits.ts.
export interface BalanceResponse {
  user_id: string;
  balance: number;
  recent_entries: {
    id: string;
    delta: number;
    reason: string;
    related_entity_id: string | null;
    balance_after: number | null;
    created_at: number;
  }[];
}

export interface ClaimResponse {
  user_id: string;
  status: "claimed" | "rate_limited";
  granted: number;
  balance: number;
}

export interface BalanceState {
  balance: number | null;
  lastDelta: number | null;
  refresh: () => Promise<void>;
  signalDelta: (delta: number) => void;
}

/**
 * Owns the live credit balance for the demo user. Refresh is explicit —
 * callers fire it after any API call known to change the balance:
 *   - claim (POST /api/credits/claim)
 *   - fix-job creation (POST /api/fix-jobs returning 202)
 *   - terminal SSE events (`complete` / `error_event`)
 *   - recovery (POST /api/fix-jobs/:id/recover)
 *
 * `lastDelta` is set automatically when refresh() observes a balance change,
 * AND can be set explicitly via signalDelta() for caller-driven pulses
 * (e.g. claim returns granted=25 → signalDelta(25) before refresh).
 */
export function useBalance(apiBase: string | undefined): BalanceState {
  const [balance, setBalance] = useState<number | null>(null);
  const [lastDelta, setLastDelta] = useState<number | null>(null);
  const balanceRef = useRef<number | null>(null);

  useEffect(() => {
    balanceRef.current = balance;
  }, [balance]);

  const refresh = useCallback(async () => {
    if (!apiBase) return;
    try {
      const res = await fetch(`${apiBase}/api/credits/balance`, {
        cache: "no-store",
      });
      if (!res.ok) return;
      const data = (await res.json()) as BalanceResponse;
      const prev = balanceRef.current;
      if (prev !== null && data.balance !== prev) {
        setLastDelta(data.balance - prev);
      }
      setBalance(data.balance);
    } catch (err) {
      if (typeof console !== "undefined") {
        console.warn("[useBalance] refresh failed", err);
      }
    }
  }, [apiBase]);

  const signalDelta = useCallback((delta: number) => {
    if (delta !== 0) setLastDelta(delta);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { balance, lastDelta, refresh, signalDelta };
}

export async function claimCredits(
  apiBase: string,
  demoCode: string | null,
): Promise<ClaimResponse | null> {
  try {
    const res = await fetch(
      `${apiBase}/api/credits/claim`,
      withDemoHeaders(demoCode, {
        method: "POST",
        cache: "no-store",
      }),
    );
    if (!res.ok) return null;
    return (await res.json()) as ClaimResponse;
  } catch (err) {
    if (typeof console !== "undefined") {
      console.warn("[claimCredits] failed", err);
    }
    return null;
  }
}
