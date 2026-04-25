import {
  Bot,
  CheckCircle2,
  GitPullRequest,
  Lock,
  Moon,
  Shield,
} from "lucide-react";

export default function Features() {
  return (
    <section className="cp-section" id="builders">
      <span className="cp-section-eyebrow">BUILT FOR BUILDERS</span>
      <h2 className="cp-section-h">
        The mechanism, <em>not the marketing.</em>
      </h2>
      <p className="cp-section-sub">
        Three reasons why CrowdPatch is safe to point at production code.
      </p>

      <div className="cp-features">
        <div className="cp-feature">
          <div className="cp-feature-icon">
            <Shield aria-hidden />
          </div>
          <h3 className="cp-feature-title">Sterile Sandboxing</h3>
          <p className="cp-feature-body">
            The agent operates in a locked, single-use container. It never
            touches your default branch. It never sees your secrets. It only
            knows the cloned tree.
          </p>
          <div className="cp-feature-foot">
            <Lock aria-hidden />
            <span>1 sandbox · 1 PR · 0 side effects</span>
          </div>
        </div>

        <div className="cp-feature">
          <div className="cp-feature-icon">
            <Bot aria-hidden />
          </div>
          <h3 className="cp-feature-title">Fire and Forget</h3>
          <p className="cp-feature-body">
            Trigger a patch and walk away. The queue handles itself. The system
            operates entirely asynchronously, pinging you only when a verified
            PR is ready to merge.
          </p>
          <div className="cp-feature-foot">
            <Moon aria-hidden />
            <span>Runs in background · Tab-safe execution</span>
          </div>
        </div>

        <div className="cp-feature">
          <div className="cp-feature-icon">
            <GitPullRequest aria-hidden />
          </div>
          <h3 className="cp-feature-title">Strict Verification</h3>
          <p className="cp-feature-body">
            We make the agent prove its work, reproduce the failure before
            patching, and clear the test suite before committing. No PR is
            opened on red. No green PR without a test.
          </p>
          <div className="cp-feature-foot">
            <CheckCircle2 aria-hidden />
            <span>Proof of failure · Proof of fix</span>
          </div>
        </div>
      </div>
    </section>
  );
}
