// Thin wrapper around the Anthropic SDK. Intentionally minimal — the
// streaming loop lives in the route handler so it can interleave D1 updates
// + observability with event handling.

import Anthropic from "@anthropic-ai/sdk";

export const SESSION_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
export const REPO_MOUNT_PATH = "/workspace/repo";

export function getAnthropicClient(apiKey: string): Anthropic {
  return new Anthropic({ apiKey });
}
