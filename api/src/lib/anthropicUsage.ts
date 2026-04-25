// Pure helper for projecting the Anthropic Managed Agents `sessions.retrieve()`
// usage shape into the four columns the fix_jobs row expects.
//
// SDK shape (verified against @anthropic-ai/sdk@^0.90.0,
// resources/beta/sessions/sessions.d.ts):
//
//   interface BetaManagedAgentsSessionUsage {
//     cache_creation?: {
//       ephemeral_1h_input_tokens?: number;
//       ephemeral_5m_input_tokens?: number;
//     };
//     cache_read_input_tokens?: number;
//     input_tokens?: number;
//     output_tokens?: number;
//   }
//
// Why nulls instead of zeros: zero is a real, observable value (e.g. a session
// that read from cache but never wrote). NULL means "we don't know" — the SDK
// didn't expose the field, or sessions.retrieve() failed and we never saw it.
// Preserving that distinction is what lets the UI render `—` honestly.

import type { BetaManagedAgentsSessionUsage } from "@anthropic-ai/sdk/resources/beta/sessions/sessions.mjs";

export interface CumulativeUsage {
  input: number | null;
  output: number | null;
  cacheCreation: number | null;
  cacheRead: number | null;
}

export function extractCumulativeUsage(
  usage: BetaManagedAgentsSessionUsage | undefined,
): CumulativeUsage {
  if (!usage) {
    return { input: null, output: null, cacheCreation: null, cacheRead: null };
  }

  const input = usage.input_tokens ?? null;
  const output = usage.output_tokens ?? null;
  const cacheRead = usage.cache_read_input_tokens ?? null;

  // cache_creation is a sub-object split by ephemeral lifetime. Sum both
  // buckets into a single demo-friendly figure. If the parent object is
  // missing, the column stays NULL; if either ephemeral_* is missing,
  // it contributes 0 to the sum.
  let cacheCreation: number | null = null;
  if (usage.cache_creation) {
    const e5 = usage.cache_creation.ephemeral_5m_input_tokens ?? 0;
    const e1h = usage.cache_creation.ephemeral_1h_input_tokens ?? 0;
    cacheCreation = e5 + e1h;
  }

  return { input, output, cacheCreation, cacheRead };
}
