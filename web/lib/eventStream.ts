// Typed wrapper around native EventSource for the fix-job SSE stream.
//
// Wire contract: see .agents/plans/sequential-soaring-plum.md §"SSE wire contract".
//
// - Per-kind progress events (kickoff, install, test, ...) → onCard
// - Terminal `complete` event → onComplete (closes the stream)
// - Terminal `error_event` event → onAppError (closes the stream)
// - Native EventSource `error` event (transport-level) → onTransportError
//   (browser auto-reconnects; not terminal — reserved for app-level error_event)

"use client";

import { type Card, PROGRESS_KINDS } from "@/types/cards";

export type CardHandler = (card: Card) => void;
export type CompleteHandler = (data: {
  pr_url: string;
  fix_job_id: string;
  ended_reason: string;
  summary_text: string;
}) => void;
export type AppErrorHandler = (data: {
  label: string;
  ended_reason: string;
}) => void;
export type TransportHandler = (e: Event) => void;

export interface SubscribeHandlers {
  onCard: CardHandler;
  onComplete: CompleteHandler;
  onAppError: AppErrorHandler;
  onTransportError?: TransportHandler;
}

export function subscribeToFixJob(
  streamUrl: string,
  handlers: SubscribeHandlers,
): () => void {
  const es = new EventSource(streamUrl);

  for (const name of PROGRESS_KINDS) {
    es.addEventListener(name, (e) => {
      try {
        const card = JSON.parse((e as MessageEvent).data) as Card;
        handlers.onCard(card);
      } catch {
        // ignore malformed payload
      }
    });
  }

  es.addEventListener("complete", (e) => {
    try {
      const raw = JSON.parse((e as MessageEvent).data) as {
        pr_url: string;
        fix_job_id: string;
        ended_reason: string;
        summary_text?: string;
      };
      // Older persisted complete events (Day 4 and earlier) lack summary_text;
      // default to empty string so the success card just hides the block.
      handlers.onComplete({ ...raw, summary_text: raw.summary_text ?? "" });
    } catch {
      // ignore malformed payload
    } finally {
      es.close();
    }
  });

  es.addEventListener("error_event", (e) => {
    try {
      const data = JSON.parse((e as MessageEvent).data) as {
        label: string;
        ended_reason: string;
      };
      handlers.onAppError(data);
    } catch {
      // ignore malformed payload
    } finally {
      es.close();
    }
  });

  // Native transport-level error (network blip, CORS reject). Browser
  // auto-reconnects. NOT terminal — reserved for app-level error_event.
  es.addEventListener("error", (e) => {
    handlers.onTransportError?.(e);
  });

  return () => es.close();
}
