"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { LucideIcon } from "./LucideIcon";
import { FIX_JOB_TIMELINE } from "./fix-job-data";

export type FixJobStreamProps = {
  compact?: boolean;
  maxRows?: number;
  onStage?: (stage: string, isDone: boolean) => void;
  showFoot?: boolean;
  bugId?: string;
};

export default function FixJobStream({
  compact = false,
  maxRows = 7,
  onStage,
  showFoot = true,
  bugId = "bug_204",
}: FixJobStreamProps) {
  const timeline = FIX_JOB_TIMELINE;
  const [tick, setTick] = useState(0);
  const [iter, setIter] = useState(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loopResetRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // advance through events
  useEffect(() => {
    const cur = timeline[tick];
    const dur = cur ? cur.dur : 1000;
    timerRef.current = setTimeout(() => {
      setTick((t) => {
        const next = t + 1;
        if (next >= timeline.length) {
          // pause then loop — track this nested timer too so we don't
          // leak setIter/setTick on unmount during the 1600ms pause.
          loopResetRef.current = setTimeout(() => {
            setIter((i) => i + 1);
            setTick(0);
          }, 1600);
          return t;
        }
        return next;
      });
    }, dur);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (loopResetRef.current) clearTimeout(loopResetRef.current);
    };
  }, [tick, iter, timeline]);

  // notify parent when stage changes
  useEffect(() => {
    if (!onStage) return;
    const cur = timeline[tick];
    if (cur) onStage(cur.stage, tick === timeline.length - 1);
  }, [tick, iter, onStage, timeline]);

  // visible window of events: last `maxRows` up to current tick
  const visible = useMemo(() => {
    const start = Math.max(0, tick - maxRows + 1);
    return timeline
      .slice(start, tick + 1)
      .map((e, i) => ({ ...e, _abs: start + i }));
  }, [tick, maxRows, timeline]);

  const isLast = tick === timeline.length - 1;
  const status = isLast
    ? { label: "PR opened", cls: "merged" }
    : { label: "Agent working", cls: "" };

  // synthetic mono timestamp like 14:02:31 — recomputed each loop iteration
  // so the displayed timestamps reset along with the event index. The
  // `iter * 0` term is a no-op that pulls iter into the memo body, so the
  // exhaustive-deps lint sees iter consumed.
  const baseTs = useMemo(() => {
    const d = new Date();
    d.setHours(14, 2, 0, 0);
    return new Date(d.getTime() + iter * 0);
  }, [iter]);
  const tsFor = (absIdx: number) => {
    const t = new Date(baseTs.getTime() + absIdx * 4500);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${pad(t.getHours())}:${pad(t.getMinutes())}:${pad(t.getSeconds())}`;
  };

  const elapsed = useMemo(() => {
    const total = timeline.reduce((s, e) => s + e.dur, 0);
    const upto = timeline.slice(0, tick + 1).reduce((s, e) => s + e.dur, 0);
    return {
      pct: Math.min(100, Math.round((upto / total) * 100)),
      total,
    };
  }, [tick, timeline]);

  return (
    <div className="cp-card">
      <div className="cp-card-head">
        <div className="cp-card-head-left">
          <div className="cp-traffic">
            <span></span>
            <span></span>
            <span></span>
          </div>
          <span className="cp-card-title">
            fix_job <span className="id">a8c12f31</span> · {bugId}
          </span>
        </div>
        <span className={`cp-card-status ${status.cls}`}>
          <span className="dot"></span>
          {status.label}
        </span>
      </div>

      <div className={`cp-eventlog ${compact ? "compact" : ""}`}>
        {visible.map((e) => {
          const isActive = e._abs === tick && !isLast;
          return (
            <div
              key={`${iter}-${e._abs}`}
              className={`cp-event ${e.kind}`}
              style={{ animationDelay: "0ms" }}
            >
              <span className="ts">{tsFor(e._abs)}</span>
              <span className="icon">
                <LucideIcon name={e.icon} aria-hidden />
              </span>
              <span className="label">
                {e.label}
                {isActive && <span className="cp-cursor"></span>}
              </span>
              <span className="meta">{e.meta}</span>
            </div>
          );
        })}
      </div>

      {showFoot && (
        <div className="cp-card-foot">
          <span>
            {isLast
              ? "Done · ◈ +30 credits"
              : `Step ${tick + 1} / ${timeline.length}`}
          </span>
          <div className="progress">
            <div
              className="progress-fill"
              style={{
                width: `${elapsed.pct}%`,
                background: isLast
                  ? "linear-gradient(90deg, var(--lime-500), var(--lime-400))"
                  : "linear-gradient(90deg, var(--violet-500), var(--violet-400))",
                animation: "none",
                transition: "width 0.4s var(--ease)",
              }}
            ></div>
          </div>
          <span style={{ fontFamily: "var(--font-mono)" }}>
            {isLast
              ? "1m 47s"
              : `~${Math.max(1, Math.ceil((100 - elapsed.pct) / 18))}m left`}
          </span>
        </div>
      )}
    </div>
  );
}
