"use client";

import { useState } from "react";
import FixJobStream from "./FixJobStream";
import { LucideIcon, type LucideIconName } from "./LucideIcon";
import { FIX_JOB_STAGES } from "./fix-job-data";

export default function LiveFixJob() {
  const [stage, setStage] = useState("kickoff");
  const [done, setDone] = useState(false);

  const stages = FIX_JOB_STAGES;
  const stageIdx = stages.findIndex((s) => s.id === stage);

  return (
    <section className="cp-section" id="live">
      <span className="cp-section-eyebrow">LIVE FIX-JOB</span>
      <h2 className="cp-section-h">
        Managed Agents <em>do the work.</em>
      </h2>
      <p className="cp-section-sub">Raw event stream. Zero demoware.</p>

      <div className="cp-livejob">
        <div className="cp-livejob-side">
          <h3>What&apos;s happening right now</h3>
          <p>
            Claude is deployed. Sandbox isolated. The agent is actively tracing
            and patching a community-reported flaw.
          </p>

          <ul className="stage-list">
            {stages.map((s, i) => {
              const cls = done
                ? "done"
                : i < stageIdx
                  ? "done"
                  : i === stageIdx
                    ? "active"
                    : "";
              const iconName: LucideIconName =
                cls === "done" ? "check-circle-2" : s.icon;
              return (
                <li key={s.id} className={cls}>
                  <LucideIcon name={iconName} aria-hidden />
                  <span>{s.label}</span>
                </li>
              );
            })}
          </ul>

          <div className="meta-grid">
            <div className="meta-cell">
              <div className="k">Repo</div>
              <div className="v orange">indie-todos</div>
            </div>
            <div className="meta-cell">
              <div className="k">Bug</div>
              <div className="v">bug_204</div>
            </div>
            <div className="meta-cell">
              <div className="k">Agent</div>
              <div className="v violet">claude-opus-4.7</div>
            </div>
            <div className="meta-cell">
              <div className="k">Reward</div>
              <div className="v lime">◈ +30</div>
            </div>
          </div>
        </div>

        <div className="cp-livejob-stream">
          <FixJobStream
            maxRows={11}
            bugId="bug_204"
            onStage={(s, isDone) => {
              setStage(s);
              setDone(isDone);
            }}
            showFoot={true}
          />
        </div>
      </div>
    </section>
  );
}
