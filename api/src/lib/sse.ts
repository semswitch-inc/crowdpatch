// SSE wire helpers — keep formatting in one place so the contract is easy
// to reason about. See .agents/plans/sequential-soaring-plum.md §"SSE wire
// contract" for the canonical event-name list.

export function formatSseEvent(name: string, data: string): string {
  // Each SSE message: "event: <name>\ndata: <data>\n\n"
  return `event: ${name}\ndata: ${data}\n\n`;
}

export const HEARTBEAT_INTERVAL_MS = 15_000;
export const HEARTBEAT_LINE = ":heartbeat\n\n";
