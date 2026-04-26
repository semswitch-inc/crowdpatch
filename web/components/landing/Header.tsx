import Image from "next/image";
import Link from "next/link";
import { Play } from "lucide-react";

const REPO_URL = "https://github.com/semswitch-inc/crowdpatch";

export default function Header() {
  return (
    <header className="cp-header" data-screen-label="header">
      <Link href="/" className="cp-brand">
        <Image
          className="cp-brand-mark"
          src="/logomark.svg"
          alt=""
          width={28}
          height={28}
          priority
        />
        <span className="cp-brand-name">CrowdPatch</span>
      </Link>
      <nav className="cp-nav">
        <a href="#loop">How it works</a>
        <a href="#live">Live fix-job</a>
        <a href="#builders">Builders</a>
        <a href={REPO_URL} target="_blank" rel="noreferrer">
          GitHub
        </a>
        <Link href="/demo" prefetch={false} className="cp-nav-demo">
          <Play aria-hidden />
          Demo
        </Link>
        <Link href="/demo" prefetch={false} className="cp-nav-cta">
          Add a repo <span aria-hidden>→</span>
        </Link>
      </nav>
    </header>
  );
}
