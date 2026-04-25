"use client";

import Link from "next/link";
import Image from "next/image";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

import AppSubmissionForm from "@/components/AppSubmissionForm";
import BugReportForm from "@/components/BugReportForm";
import ConnectedAppCard from "@/components/ConnectedAppCard";
import CreditDisplay from "@/components/CreditDisplay";
import FixBugButton from "@/components/FixBugButton";
import StepIndicator from "@/components/StepIndicator";
import SubmittedBugCard from "@/components/SubmittedBugCard";
import { useBalance } from "@/lib/credits";
import type { ConnectedApp } from "@/types/connected-app";
import type { SubmittedBug } from "@/types/submitted-bug";

const REPO_URL = "https://github.com/semswitch-inc/crowdpatch";

type Phase = "connect" | "bug" | "fix";
type FixStatus = "idle" | "running" | "success" | "error";

// useSearchParams is a Client-Component hook in Next 16 and MUST be inside a
// <Suspense> boundary or the production build fails with "Missing Suspense
// boundary with useSearchParams". See web/AGENTS.md for the wider Next-16
// caveat about training-data drift.
function HeroExperience() {
  const params = useSearchParams();
  const urlBugId = params.get("bug");
  const [phase, setPhase] = useState<Phase>("connect");
  const [connected, setConnected] = useState<ConnectedApp | null>(null);
  const [submitted, setSubmitted] = useState<SubmittedBug | null>(null);
  const [fixStatus, setFixStatus] = useState<FixStatus>("idle");

  // Live balance is owned at the flow level so the chip is visible across
  // every step (including /demo?bug=<id> backup path). Refresh is fired by:
  //   - mount (inside useBalance)
  //   - claim button (CreditDisplay → onAfterClaim)
  //   - FixBugButton at every charge / terminal SSE / recovery boundary
  const apiBase = process.env.NEXT_PUBLIC_API_BASE;
  const { balance, lastDelta, refresh, signalDelta } = useBalance(apiBase);

  // Backup demo path: /demo?bug=<id> renders the simpler single-button flow,
  // but credit chip + claim still appear above so the loop stays visible.
  if (urlBugId) {
    return (
      <div className="flex w-full flex-col gap-6">
        <CreditDisplay
          balance={balance}
          lastDelta={lastDelta}
          apiBase={apiBase}
          onAfterClaim={(granted) => {
            signalDelta(granted);
            void refresh();
          }}
        />
        <FixBugButton
          bugReportId={urlBugId}
          onBalanceShouldRefresh={() => {
            void refresh();
          }}
        />
      </div>
    );
  }

  const activeStep: 1 | 2 | 3 | 4 =
    phase === "connect"
      ? 1
      : phase === "bug"
        ? 2
        : fixStatus === "success"
          ? 4
          : 3;

  return (
    <div className="flex w-full flex-col gap-6">
      <CreditDisplay
        balance={balance}
        lastDelta={lastDelta}
        apiBase={apiBase}
        onAfterClaim={(granted) => {
          signalDelta(granted);
          void refresh();
        }}
      />
      <StepIndicator active={activeStep} />

      {phase === "connect" && (
        <AppSubmissionForm
          onConnected={(c) => {
            setConnected(c);
            setPhase("bug");
          }}
        />
      )}

      {phase === "bug" && connected && (
        <>
          <ConnectedAppCard
            app={connected}
            onEdit={() => {
              setConnected(null);
              setPhase("connect");
            }}
          />
          <BugReportForm
            appId={connected.id}
            onSubmitted={(b) => {
              setSubmitted(b);
              setFixStatus("idle");
              setPhase("fix");
            }}
          />
        </>
      )}

      {phase === "fix" && connected && submitted && (
        <>
          <ConnectedAppCard app={connected} />
          <SubmittedBugCard
            bug={submitted}
            onEdit={() => {
              setSubmitted(null);
              setFixStatus("idle");
              setPhase("bug");
            }}
          />
          <FixBugButton
            bugReportId={submitted.id}
            ctaLabel="CrowdPatch it with Claude"
            onStatusChange={setFixStatus}
            onBalanceShouldRefresh={() => {
              void refresh();
            }}
          />
        </>
      )}
    </div>
  );
}

export default function Demo() {
  return (
    // cp-page (not a plain flex column) so the demo gets the same layered
    // radial-gradient background the landing uses, not just the subtler
    // body wash.
    <div className="cp-page">
      {/* ── Header ─────────────────────────────────────────── */}
      {/* Reuses the landing's .cp-header / .cp-brand styling so the demo's
          chrome matches the landing pixel-for-pixel (sticky, 14px blur,
          18px·40px padding, 28px logomark, 15px brand name @ weight 600).
          The GitHub link keeps its Tailwind treatment so it stays visible
          on mobile (cp-nav's mobile rule would otherwise hide it). */}
      <header className="cp-header">
        <Link href="/" className="cp-brand">
          <Image
            className="cp-brand-mark"
            src="/logomark.svg"
            alt=""
            width={28}
            height={28}
            priority
          />
          <span className="cp-brand-name">CrowdPatch</span>
        </Link>
        <Link
          href={REPO_URL}
          target="_blank"
          rel="noopener noreferrer"
          // inline-flex + min-h-10 keeps the link box 40px tall so the
          // header inner-height matches the landing (whose right side is a
          // ~40px cp-nav-cta button). Without this, the cp-header bottom
          // border sits ~12px higher than the landing and the brand text
          // appears to jump when nav-ing between the two pages.
          className="inline-flex items-center min-h-10 text-sm font-500 text-ink-300 underline-offset-4 transition-colors hover:text-orange-400 hover:underline"
        >
          View on GitHub →
        </Link>
      </header>

      {/* ── Main ───────────────────────────────────────────── */}
      <main className="flex w-full max-w-3xl flex-1 flex-col gap-12 self-center px-8 py-24 sm:items-start sm:px-16">
        <section className="flex flex-col items-start gap-5 text-left">
          {/* Eyebrow tag — vibrant, not whisper-grey */}
          <span className="inline-flex items-center gap-2 rounded-full border border-orange-500/40 bg-orange-500/10 px-3 py-1 font-mono text-[11px] font-600 uppercase tracking-[0.18em] text-orange-300">
            <span className="h-1.5 w-1.5 rounded-full bg-orange-400 shadow-[0_0_8px] shadow-orange-400" />
            Closed-loop bug-fix economy
          </span>

          <h1 className="max-w-2xl text-5xl font-700 leading-[1.05] tracking-[-0.02em] text-ink-50 sm:text-[64px]">
            Community-sourced bugs.
            <br />
            <span className="text-orange-400">AI-shipped fixes.</span>
          </h1>

          <p className="max-w-md text-base leading-7 text-ink-200">
            Watch a Claude Managed Agent (Opus 4.6) investigate the bug, write a
            fix, and open a real GitHub PR — live, in real time.
          </p>
        </section>

        <Suspense
          fallback={
            <div className="font-mono text-sm text-ink-300">Loading…</div>
          }
        >
          <HeroExperience />
        </Suspense>

        {/* ── How this works ─────────────────────────────── */}
        <section className="flex max-w-xl flex-col gap-3 border-t border-ink-800 pt-8 text-sm leading-6 text-ink-200">
          <h2 className="font-mono text-xs font-600 uppercase tracking-[0.18em] text-violet-300">
            How this works
          </h2>
          <p>
            This page is open source —{" "}
            <Link
              href={REPO_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="text-ink-50 underline decoration-orange-500/60 decoration-2 underline-offset-[3px] transition-colors hover:decoration-orange-400"
            >
              view source on GitHub
            </Link>
            . It&apos;s also the engine behind CrowdPatch, a closed-loop bug-fix
            economy launching soon. Built for the Built With Opus 4.7 Hackathon.
          </p>
        </section>
      </main>
    </div>
  );
}
