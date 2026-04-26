import Image from "next/image";
import Link from "next/link";
import { GitBranch, Mail, Play } from "lucide-react";

const REPO_URL = "https://github.com/semswitch-inc/crowdpatch";

export function FinalCTA() {
  return (
    <section className="cp-section" id="cta">
      <div className="cp-final-cta">
        <span className="cp-section-eyebrow">SHIP IT</span>
        <h2>
          Just <em>CrowdPatch</em> it.
        </h2>
        <p>
          Let users find the bugs and let Claude write the patches. The only
          thing left to do is hit merge.
        </p>
        <div className="cp-cta-row">
          <Link href="/demo" prefetch={false} className="cp-btn cp-btn-primary">
            Add a repo{" "}
            <span className="arrow" aria-hidden>
              →
            </span>
          </Link>
          <Link href="/demo" prefetch={false} className="cp-btn cp-btn-demo">
            <Play aria-hidden />
            See the Hackathon Demo
          </Link>
        </div>
      </div>
    </section>
  );
}

export function Footer() {
  return (
    <footer className="cp-footer">
      <div className="cp-footer-brand">
        <Image src="/logomark.svg" alt="" width={22} height={22} />
        <span>CrowdPatch</span>
        <span className="tagline-mini">~ Just CrowdPatch it. ~</span>
      </div>
      <div className="cp-footer-links">
        <a href={REPO_URL} target="_blank" rel="noreferrer">
          <GitBranch aria-hidden />
          GitHub
        </a>
        <Link href="/demo" prefetch={false}>
          <Play aria-hidden />
          Demo
        </Link>
        <a href="mailto:support@crowdpatch.dev">
          <Mail aria-hidden />
          Contact
        </a>
      </div>
      <div className="cp-footer-meta">
        crowdpatch.dev · v0.4 · built with Opus 4.7
      </div>
    </footer>
  );
}
