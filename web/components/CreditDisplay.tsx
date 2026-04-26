"use client";

import { useEffect, useState } from "react";

import { claimCredits } from "@/lib/credits";
import { useDemoCode } from "@/lib/useDemoCode";

interface CreditDisplayProps {
  balance: number | null;
  lastDelta: number | null;
  apiBase: string | undefined;
  onAfterClaim: (granted: number) => void;
}

// PATCH_COST mirrors api/src/lib/credits.ts. Hardcoded here (not fetched)
// because it's a stable demo constant; the API is the source of truth at
// charge time.
const PATCH_COST_HINT = 5;
const PULSE_DURATION_MS = 1800;

export default function CreditDisplay({
  balance,
  lastDelta,
  apiBase,
  onAfterClaim,
}: CreditDisplayProps) {
  const { code: demoCode } = useDemoCode();
  const [claiming, setClaiming] = useState(false);
  const [pulse, setPulse] = useState<number | null>(null);
  const [claimMsg, setClaimMsg] = useState<string | null>(null);

  // Drive the brief +N / −N pulse from upstream lastDelta. Both the show
  // and hide setStates run via setTimeout (microtask + delayed) so we
  // satisfy react-hooks/set-state-in-effect by avoiding any synchronous
  // setState inside the effect body.
  useEffect(() => {
    if (lastDelta === null || lastDelta === 0) return;
    const showId = setTimeout(() => {
      setPulse(lastDelta);
    }, 0);
    const hideId = setTimeout(() => {
      setPulse(null);
    }, PULSE_DURATION_MS);
    return () => {
      clearTimeout(showId);
      clearTimeout(hideId);
    };
  }, [lastDelta]);

  async function handleClaim() {
    if (claiming || !apiBase) return;
    setClaiming(true);
    setClaimMsg(null);
    try {
      const result = await claimCredits(apiBase, demoCode);
      if (!result) {
        setClaimMsg("Couldn't reach the credits API.");
        return;
      }
      if (result.status === "rate_limited") {
        setClaimMsg("Already claimed this minute — try again in 60s.");
      } else {
        setClaimMsg(`+${String(result.granted)} credits.`);
      }
      onAfterClaim(result.granted);
    } finally {
      setClaiming(false);
      // Auto-clear claim message after the same window as the pulse so the
      // chip area doesn't accumulate cruft.
      setTimeout(() => {
        setClaimMsg(null);
      }, PULSE_DURATION_MS);
    }
  }

  const balanceLabel = balance === null ? "…" : String(balance);
  const insufficient = balance !== null && balance < PATCH_COST_HINT;
  const pulseSign = pulse !== null && pulse > 0 ? "+" : "";

  return (
    <div className="flex flex-wrap items-center gap-3">
      <span
        className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-600 transition-colors ${
          insufficient
            ? "border-red-500/40 bg-red-500/[0.10] text-red-100"
            : "border-lime-500/40 bg-lime-500/[0.08] text-lime-100"
        }`}
        aria-live="polite"
        title={`Each patch costs ${String(PATCH_COST_HINT)} credits.`}
      >
        <span
          aria-hidden="true"
          className={`h-1.5 w-1.5 rounded-full shadow-[0_0_6px] ${
            insufficient
              ? "bg-red-400 shadow-red-400"
              : "bg-lime-400 shadow-lime-400"
          }`}
        />
        <span>
          {balanceLabel} <span className="text-lime-300/80">credits</span>
        </span>
        <span className="text-lime-300/60">·</span>
        <span className="font-mono text-[10px] text-lime-200/70">
          patch = {String(PATCH_COST_HINT)}
        </span>
        {pulse !== null && (
          <span
            className={`ml-1 rounded px-1.5 font-mono text-[10px] tabular-nums ${
              pulse > 0
                ? "bg-lime-500/30 text-lime-50"
                : "bg-orange-500/30 text-orange-50"
            }`}
          >
            {pulseSign}
            {String(pulse)}
          </span>
        )}
      </span>

      <button
        type="button"
        onClick={() => {
          void handleClaim();
        }}
        disabled={claiming || !apiBase}
        className="cp-btn cp-btn-sm cp-btn-ghost hover:!border-lime-500/50 hover:!text-lime-200"
      >
        {claiming ? "Claiming…" : "Claim free credits"}
      </button>

      {claimMsg && (
        <span className="font-mono text-xs text-ink-300" aria-live="polite">
          {claimMsg}
        </span>
      )}
    </div>
  );
}
