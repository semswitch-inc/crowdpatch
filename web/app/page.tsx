import FixBugButton from "@/components/FixBugButton";

export default function Home() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center bg-zinc-50 font-sans dark:bg-black">
      <main className="flex w-full max-w-3xl flex-1 flex-col items-center justify-center gap-12 bg-white px-8 py-24 dark:bg-black sm:items-start sm:px-16">
        <section className="flex flex-col items-center gap-4 text-center sm:items-start sm:text-left">
          <span className="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500 dark:text-zinc-400">
            CrowdPatch
          </span>
          <h1 className="max-w-xl text-4xl font-semibold leading-tight tracking-tight text-zinc-900 dark:text-zinc-50 sm:text-5xl">
            Closed-loop bug-fix economy.
          </h1>
          <p className="max-w-md text-base leading-7 text-zinc-600 dark:text-zinc-400">
            File a bug. An Anthropic Managed Agent investigates, fixes, and
            ships the PR.
          </p>
        </section>

        <FixBugButton bugReportId="bug_001" />

        <p className="max-w-md font-mono text-xs leading-5 text-zinc-400 dark:text-zinc-600">
          Day 1 spine — agent run is synchronous (1–5 min). Live event streaming
          arrives Day 2.
        </p>
      </main>
    </div>
  );
}
