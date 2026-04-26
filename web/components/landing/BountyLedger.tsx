"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { BOUNTY_POOL, type BountyTheme } from "./bounty-data";

const THEME_CLASSES: Record<
  BountyTheme,
  {
    line: string;
    reward: string;
    shadow: string;
    hoverReward: string;
    hoverCta: string;
  }
> = {
  lime: {
    line: "bg-lime-400",
    reward: "text-lime-300",
    shadow: "drop-shadow-[0_0_10px_rgba(125,220,26,0.4)]",
    hoverReward: "group-hover:text-lime-200",
    hoverCta: "group-hover:text-lime-300",
  },
  red: {
    line: "bg-red-400",
    reward: "text-red-300",
    shadow: "drop-shadow-[0_0_10px_rgba(255,92,82,0.4)]",
    hoverReward: "group-hover:text-red-200",
    hoverCta: "group-hover:text-red-400",
  },
  cyan: {
    line: "bg-cyan-400",
    reward: "text-cyan-300",
    shadow: "drop-shadow-[0_0_10px_rgba(34,211,238,0.4)]",
    hoverReward: "group-hover:text-cyan-200",
    hoverCta: "group-hover:text-cyan-400",
  },
  orange: {
    line: "bg-orange-400",
    reward: "text-orange-300",
    shadow: "drop-shadow-[0_0_10px_rgba(255,122,43,0.4)]",
    hoverReward: "group-hover:text-orange-200",
    hoverCta: "group-hover:text-orange-400",
  },
  violet: {
    line: "bg-violet-400",
    reward: "text-violet-300",
    shadow: "drop-shadow-[0_0_10px_rgba(138,82,255,0.4)]",
    hoverReward: "group-hover:text-violet-200",
    hoverCta: "group-hover:text-violet-400",
  },
};

export default function BountyLedger() {
  const [activeLayer, setActiveLayer] = useState(0);
  const [pages, setPages] = useState([0, 1]);
  const [totalPool, setTotalPool] = useState(12450);

  useEffect(() => {
    const interval = setInterval(() => {
      setActiveLayer((prevLayer) => {
        const nextLayer = prevLayer === 0 ? 1 : 0;

        setPages((prevPages) => {
          const newPages = [...prevPages];
          // The next layer takes the page after the current layer's page
          newPages[nextLayer] = (prevPages[prevLayer] + 1) % 4;
          return newPages;
        });

        return nextLayer;
      });

      setTotalPool((prev) => {
        const change = Math.floor(Math.random() * 150) - 40;
        return prev + change;
      });
    }, 8000);
    return () => clearInterval(interval);
  }, []);

  const renderBounties = (pageIndex: number) => {
    const visibleBounties = BOUNTY_POOL.slice(pageIndex * 3, pageIndex * 3 + 3);
    return visibleBounties.map((bounty, i) => {
      const styles = THEME_CLASSES[bounty.theme];
      return (
        <Link
          key={i}
          href="/demo"
          prefetch={false}
          className="group relative flex flex-col gap-3 p-5 transition-colors hover:bg-ink-900/80"
        >
          <div
            className={`absolute bottom-0 left-0 top-0 w-[2px] opacity-0 transition-opacity group-hover:opacity-100 ${styles.line}`}
          />

          <div className="flex items-start justify-between gap-4">
            <div className="flex min-w-0 flex-col gap-1">
              <span className="truncate font-mono text-xs font-semibold text-violet-300">
                {bounty.repo}
              </span>
              <span className="truncate font-sans text-sm text-ink-100">
                {bounty.description}
              </span>
            </div>
            <span
              className={`shrink-0 font-mono text-xl font-bold transition-colors ${styles.reward} ${styles.shadow} ${styles.hoverReward}`}
            >
              ◈ {bounty.reward}
            </span>
          </div>

          <div className="mt-1 flex items-center justify-end">
            <span
              className={`font-mono text-[11px] font-semibold text-ink-400 transition-colors ${styles.hoverCta}`}
            >
              Accept Bounty →
            </span>
          </div>
        </Link>
      );
    });
  };

  return (
    <div
      className="cp-card flex w-full flex-col !border-ink-700 !bg-ink-950/80 shadow-[0_18px_40px_rgba(0,0,0,0.6)] backdrop-blur-md"
      style={{ minHeight: "420px" }}
    >
      <div className="cp-card-head border-b border-ink-800 bg-ink-900/80 px-5 py-4">
        <h2 className="flex items-center gap-2 font-mono text-sm font-bold uppercase tracking-[0.15em] text-orange-400">
          <span className="flex h-2.5 w-2.5 animate-pulse rounded-full bg-orange-400 shadow-[0_0_8px_var(--orange-400)]" />
          Active Bug Bounties
        </h2>
        <div className="font-mono text-[11px] font-bold uppercase tracking-widest text-lime-300 drop-shadow-[0_0_4px_rgba(125,220,26,0.4)]">
          Earn Credits
        </div>
      </div>

      <div className="relative flex flex-1 flex-col overflow-hidden bg-ink-950/80">
        {/* Layer 0 */}
        <div
          className={`absolute inset-0 flex flex-col divide-y divide-ink-800/50 transition-opacity duration-[800ms] ease-in-out ${
            activeLayer === 0 ? "opacity-100 z-10" : "opacity-0 z-0"
          }`}
        >
          {renderBounties(pages[0])}
        </div>
        {/* Layer 1 */}
        <div
          className={`absolute inset-0 flex flex-col divide-y divide-ink-800/50 transition-opacity duration-[800ms] ease-in-out ${
            activeLayer === 1 ? "opacity-100 z-10" : "opacity-0 z-0"
          }`}
        >
          {renderBounties(pages[1])}
        </div>
      </div>

      <div className="cp-card-foot border-t border-ink-800/50 bg-ink-900/80 px-5 py-4 justify-end z-20 relative">
        <div className="flex items-center gap-2">
          <span>Total Pool:</span>
          <span className="font-bold text-lime-300 drop-shadow-[0_0_4px_rgba(125,220,26,0.4)]">
            ◈ {totalPool.toLocaleString("en-US")}
          </span>
        </div>
      </div>
    </div>
  );
}
