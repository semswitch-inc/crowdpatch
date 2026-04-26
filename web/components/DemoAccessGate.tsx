"use client";

import { useState, type FormEvent, type ReactNode } from "react";

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

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const trimmed = draft.trim();
    if (!trimmed) return;
    setCode(trimmed);
    setDraft("");
  }

  return (
    <form
      onSubmit={handleSubmit}
      aria-labelledby="demo_gate_title"
      autoComplete="off"
      data-form-type="other"
      className="cp-card pad-md flex w-full max-w-md mx-auto flex-col gap-4"
    >
      <div className="flex flex-col gap-1">
        <h2 id="demo_gate_title" className="cp-h3">
          Enter the demo code.
        </h2>
        <p className="cp-small">
          This protects the live demo because every patch starts a real Claude
          agent and can open a real pull request.
        </p>
      </div>

      <div className="cp-field">
        <label htmlFor="cp_demo_gate" className="cp-field-label">
          Demo access code
        </label>
        <input
          id="cp_demo_gate"
          name="crowdpatch_demo_access_code"
          type="text"
          autoComplete="one-time-code"
          autoCapitalize="none"
          autoCorrect="off"
          inputMode="text"
          spellCheck={false}
          required
          maxLength={120}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          data-1p-ignore="true"
          data-bwignore="true"
          data-form-type="other"
          data-lpignore="true"
          className="cp-input mono"
        />
        <span className="cp-field-hint">
          Paste the code you were given. It stays in this browser tab.
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
