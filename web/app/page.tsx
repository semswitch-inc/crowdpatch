"use client";

import Link from "next/link";
import Image from "next/image";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

import AppSubmissionForm from "@/components/AppSubmissionForm";
import BugReportForm from "@/components/BugReportForm";
import ConnectedAppCard from "@/components/ConnectedAppCard";
import FixBugButton from "@/components/FixBugButton";
import StepIndicator from "@/components/StepIndicator";
import SubmittedBugCard from "@/components/SubmittedBugCard";
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

  // Backup demo path: /?bug=<id> short-circuits the entire stepper and
  // renders the original button-only flow exactly like Day 4. No app form,
  // no bug form, no stepper, no credit chip — preserved as the
  // recording-day safety net.
  if (urlBugId) {
    return <FixBugButton bugReportId={urlBugId} />;
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
          />
        </>
      )}
    </div>
  );
}

export default function Home() {
  return (
    <div className="flex flex-1 flex-col">
      {/* ── Header ─────────────────────────────────────────── */}
      <header className="flex w-full items-center justify-between border-b border-ink-800 bg-ink-950/70 px-6 py-4 backdrop-blur-sm sm:px-12">
        <Link href="/" className="flex items-center gap-2.5">
          <Image src="/logomark.svg" alt="" width={28} height={28} priority />
          <span className="text-[15px] font-700 tracking-tight text-ink-50">
            CrowdPatch
          </span>
        </Link>
        <Link
          href={REPO_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm font-500 text-ink-300 underline-offset-4 transition-colors hover:text-orange-400 hover:underline"
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
