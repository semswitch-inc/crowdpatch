// Tiny text utilities. Kept dependency-free — no slugify package needed.

// Convert a free-form string into a URL/branch-safe slug:
//   "Word-diff treats whitespace!" → "word-diff-treats-whitespace"
// Lowercases, replaces every non-alphanumeric run with a single `-`, trims
// leading/trailing `-`. Falls back to `bug-fix` if normalization empties the
// input (all-symbol titles, empty strings, etc.) so a sane branch suffix is
// always produced.
export function slugify(input: string): string {
  const slug = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug.length > 0 ? slug : "bug-fix";
}
