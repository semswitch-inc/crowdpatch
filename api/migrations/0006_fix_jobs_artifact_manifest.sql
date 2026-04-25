-- 0006_fix_jobs_artifact_manifest.sql
-- R2 evidence-bundle support for the "every run writes its artifacts" demo
-- claim. Both columns are written from the AgentSessionDO finally block AND
-- from /recover terminal paths (see lib/artifacts.ts and the DO/route wiring).
--
-- artifact_manifest_json: JSON object listing every R2 object written for
--   this fix-job — { bucket, prefix, written_at, artifacts:[...], failures?:[...] }.
--   Surfaced by GET /api/fix-jobs/:id as a raw TEXT string (matches the
--   result_summary_json convention; client parses on demand). NULL until the
--   first artifact write completes; null on rows pre-dating this migration.
--
-- prompt_snapshot_text: the EXACT user.message string sent to the Managed
--   Agent at session start. Persisted before events.send() so /recover can
--   reproduce a faithful agent-prompt.txt artifact even if apps.agent_notes
--   or apps.setup_commands changed between the original DO run and recovery.
--   NULL on the malformed-URL defensive path (agent never gets a prompt) and
--   on rows pre-dating this migration.
--
-- Both columns nullable; additive only. No backfill.

ALTER TABLE fix_jobs ADD COLUMN artifact_manifest_json TEXT;
ALTER TABLE fix_jobs ADD COLUMN prompt_snapshot_text TEXT;
