-- 0004_fix_jobs_variant_and_usage.sql
-- Two unrelated additions, bundled so we redeploy + apply once.
--
-- 1. agent_variant: lets POST /api/fix-jobs target one of N pre-bootstrapped
--    Managed Agents (A/B/C/D) instead of the single ANTHROPIC_AGENT_ID
--    secret. NULL = legacy unspecified path (uses ANTHROPIC_AGENT_ID).
--    Originally added to A/B/C/D-test prompt variants against the Anthropic
--    safety classifier without mutating one shared agent in the dashboard.
--
-- 2. first_*_tokens: usage stats from the FIRST span.model_request_end
--    event in the session stream. We capture FIRST not TOTAL because
--    first-request size is deterministic for a given (system_prompt +
--    tool_set + user_message) tuple; later requests include conversation
--    history and vary wildly. First-request token counts are the cleanest
--    fingerprint for detecting Anthropic platform-side prompt drift —
--    if our prompt didn't change but the cache_read drops to 0 and the
--    creation count jumps, Anthropic added new content to their injected
--    prefix (which we cannot see directly).

ALTER TABLE fix_jobs ADD COLUMN agent_variant TEXT;
ALTER TABLE fix_jobs ADD COLUMN first_cache_creation_input_tokens INTEGER;
ALTER TABLE fix_jobs ADD COLUMN first_cache_read_input_tokens INTEGER;
ALTER TABLE fix_jobs ADD COLUMN first_input_tokens INTEGER;
ALTER TABLE fix_jobs ADD COLUMN first_output_tokens INTEGER;
