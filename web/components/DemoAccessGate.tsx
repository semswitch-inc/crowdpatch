"use client";

import { useState, type ReactNode } from "react";

import { useDemoCode } from "@/lib/useDemoCode";

interface DemoAccessGateProps {
  children: ReactNode;
}

/**
 * Hackathon-grade gate around the live demo flow. Renders a small access-code
 * prompt before any mutating API call can happen. The code is sent as the
 * `X-CrowdPatch-Demo-Code` header on every protected POST. See
 * `web/lib/useDemoCode.ts` for the sessionStorage-backed state.
 *
 * Bypasses the prompt entirely when `NEXT_PUBLIC_API_BASE` points at
 * localhost — mirrors the API's "permissive when DEMO_ACCESS_CODE unset
 * AND ENVIRONMENT=development" pass-through.
 */
export default function DemoAccessGate({ children }: DemoAccessGateProps) {
  const { code, setCode, mounted } = useDemoCode();
  const [draft, setDraft] = useState("");

  const apiBase = process.env.NEXT_PUBLIC_API_BASE;
  const isLocalApi = apiBase?.startsWith("http://localhost") ?? false;

  // Avoid a hydration flash: render nothing until the client has read
  // sessionStorage. The code is read in useEffect (see useDemoCode) so the
  // server-rendered HTML and first client paint match.
  if (!mounted) {
    return null;
  }

  if (isLocalApi || code) {
    return <>{children}</>;
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const trimmed = draft.trim();
    if (!trimmed) return;
    setCode(trimmed);
    setDraft("");
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="cp-card pad-md flex w-full max-w-md flex-col gap-4"
    >
      <div className="flex flex-col gap-1">
        <h2 className="cp-h3">Enter the demo access code.</h2>
        <p className="cp-small">
          The live agent burns real Anthropic credits on every run, so the
          public demo is gated behind a shared code. If you&apos;re a judge or
          have been invited to test, paste it here.
        </p>
      </div>

      <div className="cp-field">
        <label htmlFor="demo_access_code" className="cp-field-label">
          Demo access code
        </label>
        <input
          id="demo_access_code"
          type="password"
          autoComplete="off"
          autoFocus
          required
          maxLength={120}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          className="cp-input mono"
        />
        <span className="cp-field-hint">
          Stored in sessionStorage for this tab only. Sent as the
          X-CrowdPatch-Demo-Code header on protected POSTs.
        </span>
      </div>

      <button
        type="submit"
        disabled={!draft.trim()}
        className="cp-btn cp-btn-primary self-start"
      >
        Continue →
      </button>
    </form>
  );
}
