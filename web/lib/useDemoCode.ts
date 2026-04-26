"use client";

import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "crowdpatch_demo_code";

export interface DemoCodeState {
  code: string | null;
  setCode: (next: string) => void;
  clearCode: () => void;
  // True after first client-side mount — useful so the gate UI doesn't
  // flash during the static-export hydration. sessionStorage is read in
  // useEffect to keep server- and client-rendered HTML identical.
  mounted: boolean;
}

export function useDemoCode(): DemoCodeState {
  const [code, setCodeState] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    // Defer the setState into a microtask so we satisfy
    // react-hooks/set-state-in-effect (synchronous setState inside useEffect
    // body cascades renders). Same pattern as CreditDisplay's pulse effect.
    let stored: string | null = null;
    try {
      stored = sessionStorage.getItem(STORAGE_KEY);
    } catch {
      // sessionStorage can throw in private/locked-down browser contexts.
      // Treat that as "no code" — the gate will prompt on the next render.
    }
    const id = setTimeout(() => {
      setCodeState(stored);
      setMounted(true);
    }, 0);
    return () => {
      clearTimeout(id);
    };
  }, []);

  const setCode = useCallback((next: string) => {
    try {
      sessionStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Same fallback as above — keep the in-memory state so the rest of
      // the session works even if persistence failed.
    }
    setCodeState(next);
  }, []);

  const clearCode = useCallback(() => {
    try {
      sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
    setCodeState(null);
  }, []);

  return { code, setCode, clearCode, mounted };
}
