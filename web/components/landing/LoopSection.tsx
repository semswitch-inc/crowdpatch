import {
  Bot,
  Bug,
  GitMerge,
  GitPullRequest,
  Shield,
  Users,
} from "lucide-react";

export default function LoopSection() {
  return (
    <section className="cp-section" id="loop">
      <span className="cp-section-eyebrow">THE LOOP</span>
      <h2 className="cp-section-h">
        Three jobs.
        <br />
        One <em>closed-loop economy.</em>
      </h2>
      <p className="cp-section-sub">
        Humans provide the signal. Claude provides the labor. You stay the
        curator — reviewing PRs instead of chasing tickets.
      </p>

      <div className="cp-loop-rows">
        <div className="cp-loop-cell find">
          <span className="step-num">01 · CROWD</span>
          <div className="step-icon">
            <Users aria-hidden />
          </div>
          <h3 className="step-title">The crowd exposes it</h3>
          <p className="step-text">
            Flag the bugs. File the repro. Earn{" "}
            <strong style={{ color: "var(--lime-300)" }}>◆ credits</strong> for
            stress-testing the community.
          </p>
          <div className="step-foot">
            <Bug aria-hidden />
            <span>
              Human signal · <strong>◈ Verified bug</strong>
            </span>
          </div>
        </div>

        <div className="cp-loop-cell fix">
          <span className="step-num">02 · CLAUDE</span>
          <div className="step-icon">
            <Bot aria-hidden />
          </div>
          <h3 className="step-title">Claude resolves it</h3>
          <p className="step-text">
            Deploy Claude with your credits. The agent diagnoses, patches, and
            signs the commit while you step away.
          </p>
          <div className="step-foot">
            <Shield aria-hidden />
            <span>
              AI labor · <strong>1–5 min</strong> · Async
            </span>
          </div>
        </div>

        <div className="cp-loop-cell ship">
          <span className="step-num">03 · YOU</span>
          <div className="step-icon">
            <GitPullRequest aria-hidden />
          </div>
          <h3 className="step-title">You deploy it</h3>
          <p className="step-text">
            The fix lands as a verified PR. Review, merge, ship. The cycle
            repeats.
          </p>
          <div className="step-foot">
            <GitMerge aria-hidden />
            <span>
              Merged PR · <strong>◈ Credits awarded</strong>
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}
