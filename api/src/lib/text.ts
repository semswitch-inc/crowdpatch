// Tiny text utilities. Kept dependency-free — no slugify package needed.

// Convert a free-form string into a URL/branch-safe slug:
//   "Word-diff treats whitespace!" → "word-diff-treats-whitespace"
// Lowercases, replaces every non-alphanumeric run with a single `-`, trims
// leading/trailing `-`. Falls back to `bug-fix` if normalization empties the
// input (all-symbol titles, empty strings, etc.) so a sane branch suffix is
// always produced.
// Distill the agent's reply text down to a short, presentable summary.
// Used in two places:
//   * SSE `complete` event's `summary_text` (capped, web-friendly)
//   * GitHub PR body's "Agent's final summary" block (no cap)
// Filters AGENT_DONE marker lines and empty lines, keeps the last 5
// substantive lines. Trims each line so leading whitespace from agent
// output doesn't leak into rendered cards.
export function buildAgentSummary(
  agentReplyText: string,
  opts: { maxChars?: number } = {},
): string {
  const summary = agentReplyText
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.includes("AGENT_DONE"))
    .slice(-5)
    .join("\n");
  return opts.maxChars ? summary.slice(0, opts.maxChars) : summary;
}

export function slugify(input: string): string {
  const slug = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug.length > 0 ? slug : "bug-fix";
}
