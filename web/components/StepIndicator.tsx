// Compact 4-step horizontal indicator rendered above the active phase's
// content. Pure presentational — owns no state. Active step uses the orange
// accent; completed steps render with a check + dimmed lime; future steps
// are muted ink. Wraps cleanly on narrow viewports via flex-wrap.

interface StepIndicatorProps {
  active: 1 | 2 | 3 | 4;
}

const STEPS: ReadonlyArray<{ n: 1 | 2 | 3 | 4; label: string }> = [
  { n: 1, label: "Connect app" },
  { n: 2, label: "Submit bug report" },
  { n: 3, label: "CrowdPatch it" },
  { n: 4, label: "PR opened" },
];

export default function StepIndicator({ active }: StepIndicatorProps) {
  return (
    <ol className="flex w-full flex-wrap items-center gap-2 font-mono text-[11px] font-600 uppercase tracking-[0.12em] sm:text-xs">
      {STEPS.map((step, idx) => {
        const state =
          step.n < active ? "done" : step.n === active ? "active" : "future";
        return (
          <li
            key={step.n}
            className="flex items-center gap-2"
            aria-current={state === "active" ? "step" : undefined}
          >
            <span className={pillClass(state)}>
              <span className={badgeClass(state)}>
                {state === "done" ? "✓" : step.n}
              </span>
              <span>{step.label}</span>
            </span>
            {idx < STEPS.length - 1 && (
              <span aria-hidden="true" className="text-ink-500">
                ·
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}

function pillClass(state: "done" | "active" | "future"): string {
  const base =
    "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 transition-colors";
  if (state === "active") {
    return `${base} border-orange-500/60 bg-orange-500/[0.12] text-orange-100`;
  }
  if (state === "done") {
    return `${base} border-lime-500/40 bg-lime-500/[0.08] text-lime-200/80`;
  }
  return `${base} border-ink-700 bg-ink-900/40 text-ink-400`;
}

function badgeClass(state: "done" | "active" | "future"): string {
  const base =
    "inline-flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-700 tabular-nums";
  if (state === "active") return `${base} bg-orange-500 text-ink-black`;
  if (state === "done") return `${base} bg-lime-500/40 text-lime-50`;
  return `${base} bg-ink-800 text-ink-300`;
}
