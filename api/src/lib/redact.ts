// Scrub known secret patterns from log strings before they're written to
// disk, sent to clients, or stored in D1. Add new patterns here as they
// come up; never log raw env values without passing them through this first.

const PATTERNS: Array<readonly [RegExp, string]> = [
  [/sk-ant-api03-[A-Za-z0-9_-]+/g, "sk-ant-api03-REDACTED"],
  [/github_pat_[A-Za-z0-9_]+/g, "github_pat_REDACTED"],
  [/(ghp_|ghs_|gho_|ghu_|ghr_)[A-Za-z0-9]+/g, "$1REDACTED"],
  [/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer REDACTED"],
];

export function redact(s: string): string {
  let out = s;
  for (const [pattern, replacement] of PATTERNS) {
    out = out.replace(pattern, replacement);
  }
  return out;
}
