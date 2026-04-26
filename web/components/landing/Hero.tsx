"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Bug, GitBranch } from "lucide-react";
import { LucideIcon, type LucideIconName } from "./LucideIcon";
import FixJobStream from "./FixJobStream";
import BountyLedger from "./BountyLedger";

export type HeroVariant = "stream" | "log" | "loop" | "bounties";

type HeroProps = { variant?: HeroVariant };

export default function Hero({ variant = "stream" }: HeroProps) {
  return (
    <section className="cp-hero">
      <div className="cp-hero-left">
        <span className="cp-hackbadge">
          <span>BUILT WITH OPUS 4.7</span>
          <span className="cp-hackbadge-divider"></span>
          <span className="cp-hackbadge-tag">HACKATHON · 2026</span>
        </span>

        <h1 className="cp-display">
          Crowd finds it.
          <br />
          <em>Claude fixes it.</em>
          <br />
          <span className="lime">You ship it.</span>
        </h1>

        <div className="cp-tagline-rail">
          <span className="cp-tilde">~</span>
          <span>
            <strong>Bug reports</strong> become <strong>merged PRs.</strong>
          </span>
          <span className="cp-tilde">~</span>
        </div>

        <p className="cp-lede">
          CrowdPatch turns user complaints into autonomous pull requests.
          <strong> The crowd breaks it, Claude patches it.</strong>
        </p>

        <div className="cp-cta-row">
          <Link href="/demo" prefetch={false} className="cp-btn cp-btn-primary">
            Add a repo{" "}
            <span className="arrow" aria-hidden>
              →
            </span>
          </Link>
          <a
            href="https://github.com/semswitch-inc/crowdpatch"
            target="_blank"
            rel="noopener noreferrer"
            className="cp-btn cp-btn-demo"
          >
            <GitBranch aria-hidden />
            View on GitHub
          </a>
        </div>

        <p className="cp-hint cp-hint-tagline">
          <span className="cp-tilde">~</span>
          just CrowdPatch it!
          <span className="cp-tilde">~</span>
        </p>
      </div>

      <div className="cp-hero-right">
        {variant === "stream" && <HeroVariantStream />}
        {variant === "log" && <HeroVariantLog />}
        {variant === "loop" && <HeroVariantLoop />}
        {variant === "bounties" && <BountyLedger />}
      </div>
    </section>
  );
}

// ── Variant A: full live-stream card ─────────────────────────
function HeroVariantStream() {
  return (
    <div className="cp-card cp-livestream">
      <div className="cp-card-head">
        <div className="cp-card-head-left">
          <div className="cp-traffic">
            <span></span>
            <span></span>
            <span></span>
          </div>
          <span className="cp-card-title">
            live · fix_job <span className="id">a8c12f31</span>
          </span>
        </div>
        <span className="cp-card-status">
          <span className="dot"></span>Agent working
        </span>
      </div>
      <div className="cp-stream-banner">
        <div className="stream-bug">
          <Bug aria-hidden />
          <span>
            <strong>bug_204</strong> · &quot;Drag-reorder loses item on
            drop&quot;
          </span>
        </div>
      </div>
      <FixJobStream maxRows={6} bugId="bug_204" />
    </div>
  );
}

// ── Variant B: event-log only ────────────────────────────────
function HeroVariantLog() {
  return <FixJobStream maxRows={8} bugId="bug_204" />;
}

// ── Variant C: three-beat loop ───────────────────────────────
type Beat = {
  cls: "find" | "fix" | "ship";
  icon: LucideIconName;
  label: string;
  title: string;
  text: string;
};

const BEATS: Beat[] = [
  {
    cls: "find",
    icon: "users",
    label: "01 · Expose",
    title: "Users find the flaws",
    text: "Structured report · Repro steps · Zero noise.",
  },
  {
    cls: "fix",
    icon: "bot",
    label: "02 · Execute",
    title: "Claude writes the code",
    text: "Sandbox · Diagnose · Test · Commit.",
  },
  {
    cls: "ship",
    icon: "git-pull-request",
    label: "03 · Deploy",
    title: "The PR is ready",
    text: "Review · Merge · Ship.",
  },
];

function HeroVariantLoop() {
  const [active, setActive] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setActive((a) => (a + 1) % 3), 1800);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="cp-card cp-loopvis">
      <div className="beat-row">
        {BEATS.map((b, i) => (
          <div
            key={b.cls}
            className={`beat ${b.cls} ${i === active ? "active" : ""}`}
          >
            <div className="bigicon">
              <LucideIcon name={b.icon} aria-hidden />
            </div>
            <div className="beat-label">{b.label}</div>
            <div className="beat-title">{b.title}</div>
            <div className="beat-text">{b.text}</div>
          </div>
        ))}
      </div>
      <div className="arrows">
        <div className="arrow-cell"></div>
        <div className="arrow-cell"></div>
        <div className="arrow-cell"></div>
      </div>
      <div className="summary-rail">
        <span>
          <strong>100% async</strong> execution
        </span>
        <span>
          <strong>◈ earn credits</strong> per merged PR
        </span>
        <span>0 humans on the keyboard</span>
      </div>
    </div>
  );
}
