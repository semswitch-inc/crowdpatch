import { Suspense } from "react";
import BugDeepLinkRedirect from "@/components/landing/BugDeepLinkRedirect";
import Features from "@/components/landing/Features";
import Header from "@/components/landing/Header";
import Hero from "@/components/landing/Hero";
import LiveFixJob from "@/components/landing/LiveFixJob";
import LoopSection from "@/components/landing/LoopSection";
import { FinalCTA, Footer } from "@/components/landing/Footer";

export default function Page() {
  return (
    <div className="cp-page">
      <Suspense fallback={null}>
        <BugDeepLinkRedirect />
      </Suspense>
      <Header />
      <main className="cp-main">
        <Hero variant="bounties" />
        <LoopSection />
        <LiveFixJob />
        <Features />
        <FinalCTA />
      </main>
      <Footer />
    </div>
  );
}
