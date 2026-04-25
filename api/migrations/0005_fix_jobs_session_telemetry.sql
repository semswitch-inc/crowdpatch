-- 0005_fix_jobs_session_telemetry.sql
-- Cumulative session-level telemetry. Complements migration 0004's
-- first_*_tokens (deterministic platform-prompt-drift fingerprint) with
-- end-of-session totals retrieved via client.beta.sessions.retrieve()
-- inside the AgentSessionDO finally block — see decision #5/#6 in the
-- "Managed Agents traceability & cleanup" plan.
--
-- Why both first_* AND total_*:
--   first_*  → 1-request fingerprint, identical inputs ⇒ identical numbers,
--              detects upstream prompt-prefix drift cleanly.
--   total_*  → demo-grade "this fix burned X tokens / Y cache hits" stat,
--              varies with conversation length but is what judges/users
--              actually want to see in the UI.
--
-- Why agent model + version columns:
--   agent_variant (0004) tells us A/B/C/D, but Anthropic can swap the
--   underlying model/version under a given agent. Stamping model.id and
--   version per fix-job gives an audit trail for "this PR was opened by
--   claude-opus-4-7 v3.2.1 acting as agent variant B".
--
-- All columns nullable: old rows pre-dating this migration return NULL,
-- which the UI renders as "—".

ALTER TABLE fix_jobs ADD COLUMN total_input_tokens INTEGER;
ALTER TABLE fix_jobs ADD COLUMN total_output_tokens INTEGER;
ALTER TABLE fix_jobs ADD COLUMN total_cache_creation_input_tokens INTEGER;
ALTER TABLE fix_jobs ADD COLUMN total_cache_read_input_tokens INTEGER;
ALTER TABLE fix_jobs ADD COLUMN anthropic_agent_model TEXT;
ALTER TABLE fix_jobs ADD COLUMN anthropic_agent_version TEXT;
