"use client";

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";

// Static export rules out next.config redirects() and server-side redirect(),
// so we redirect on hydration. Wrap in <Suspense> at the call site — Next 16
// requires it for any Client Component that calls useSearchParams during a
// statically prerendered page (or the build fails).
export default function BugDeepLinkRedirect() {
  const router = useRouter();
  const params = useSearchParams();

  useEffect(() => {
    const bug = params.get("bug");
    if (bug) router.replace(`/demo?bug=${encodeURIComponent(bug)}`);
  }, [params, router]);

  return null;
}
