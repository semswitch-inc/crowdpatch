"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

import FixBugButton from "@/components/FixBugButton";

const REPO_URL = "https://github.com/semswitch-inc/crowdpatch";

// useSearchParams is a Client-Component hook in Next 16 and MUST be inside a
// <Suspense> boundary or the production build fails with "Missing Suspense
// boundary with useSearchParams". See web/AGENTS.md for the wider Next-16
// caveat about training-data drift.
function FixBugButtonFromQuery() {
  const params = useSearchParams();
  const bugId = params.get("bug") ?? "bug_001";
  return <FixBugButton bugReportId={bugId} />;
}

export default function Home() {
  return (
    <div className="flex flex-1 flex-col bg-zinc-50 font-sans dark:bg-black">
      <header className="flex w-full items-center justify-between border-b border-zinc-200 bg-white px-6 py-4 dark:border-zinc-800 dark:bg-black sm:px-12">
        <span className="text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
          CrowdPatch
        </span>
        <Link
          href={REPO_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm text-zinc-700 underline-offset-4 hover:underline dark:text-zinc-300"
        >
          View on GitHub →
        </Link>
      </header>

      <main className="flex w-full max-w-3xl flex-1 flex-col items-center gap-12 self-center bg-white px-8 py-24 dark:bg-black sm:items-start sm:px-16">
        <section className="flex flex-col items-center gap-4 text-center sm:items-start sm:text-left">
          <span className="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500 dark:text-zinc-400">
            CrowdPatch
          </span>
          <h1 className="max-w-xl text-4xl font-semibold leading-tight tracking-tight text-zinc-900 dark:text-zinc-50 sm:text-5xl">
            Closed-loop bug-fix economy.
          </h1>
          <p className="max-w-md text-base leading-7 text-zinc-600 dark:text-zinc-400">
            Watch a Claude Managed Agent investigate the bug, write a fix, and
            open a PR — live, in real time.
          </p>
        </section>

        <Suspense
          fallback={
            <div className="text-sm text-zinc-500 dark:text-zinc-500">
              Loading…
            </div>
          }
        >
          <FixBugButtonFromQuery />
        </Suspense>

        <section className="flex max-w-xl flex-col gap-2 border-t border-zinc-200 pt-8 text-sm text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">
          <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
            How this works
          </h2>
          <p className="leading-6">
            This page is open source —{" "}
            <Link
              href={REPO_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="text-zinc-900 underline underline-offset-2 hover:no-underline dark:text-zinc-100"
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
