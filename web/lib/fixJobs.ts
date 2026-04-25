// Plain-JSON client for /api/fix-jobs/:id. Lives separate from eventStream.ts
// so the SSE wire stays single-purpose and this stays focused on the
// post-terminal usage retrieval.
//
// Why polling: usage totals are written inside the AgentSessionDO finally
// block AFTER the terminal SSE event broadcasts (see api/.../agentSession.ts).
// The first GET right after the SSE may race the persistence and return
// nulls. Bounded backoff (immediate, +500ms, +1.5s, +3.5s — ~5s total)
// covers the typical retrieve+write latency without spamming the API.

"use client";

import type { FixJobSummary } from "@/types/fix-job";

// Total wall-clock cap and the backoff schedule between attempts. Tweak
// these together — the "totalElapsedMs" reasoning above is the schedule
// summed from after-the-first-attempt waits.
const POLL_DELAYS_MS = [500, 1000, 2000] as const;

export async function fetchFixJob(
  apiBase: string,
  id: string,
  signal?: AbortSignal,
): Promise<FixJobSummary | null> {
  let res: Response;
  try {
    res = await fetch(`${apiBase}/api/fix-jobs/${id}`, { signal });
  } catch {
    // Network / abort — caller treats null as "no data".
    return null;
  }
  if (!res.ok) return null;
  try {
    return (await res.json()) as FixJobSummary;
  } catch {
    return null;
  }
}

// True iff every total_* field is populated. Used as the "good enough,
// stop polling" predicate.
function hasAllTotals(j: FixJobSummary): boolean {
  return (
    j.total_input_tokens !== null &&
    j.total_output_tokens !== null &&
    j.total_cache_creation_input_tokens !== null &&
    j.total_cache_read_input_tokens !== null
  );
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("aborted", "AbortError"));
      return;
    }
    const t = setTimeout(() => {
      resolve();
    }, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        reject(new DOMException("aborted", "AbortError"));
      },
      { once: true },
    );
  });
}

// Fetch immediately; if cumulative totals are still null, retry with
// backoff. Returns the latest payload — possibly with nulls if the cap is
// exhausted (UI handles that by rendering `—`). Aborts cleanly via the
// supplied AbortSignal.
export async function pollFixJobUntilTotals(
  apiBase: string,
  id: string,
  signal?: AbortSignal,
): Promise<FixJobSummary | null> {
  let latest = await fetchFixJob(apiBase, id, signal);
  if (latest && hasAllTotals(latest)) return latest;

  for (const wait of POLL_DELAYS_MS) {
    try {
      await delay(wait, signal);
    } catch {
      return latest;
    }
    const next = await fetchFixJob(apiBase, id, signal);
    if (next) latest = next;
    if (latest && hasAllTotals(latest)) return latest;
  }
  return latest;
}
