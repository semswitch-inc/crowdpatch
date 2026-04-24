-- 0002_ended_reason.sql
-- Add ended_reason discrimination so a 'failed' status carries WHY it failed
-- (timeout vs agent error vs no push vs PR creation 422 vs cancelled).
-- 'success' is also a valid value for symmetry with status='succeeded'.
--
-- Values used by app layer:
--   'success'             — PR opened
--   'agent_error'         — session.error or unexpected stop_reason
--   'timeout'             — 10-min cap hit
--   'agent_no_push'       — agent finished but branch not on remote
--   'pr_creation_failed'  — Octokit threw on PR open
--   'client_cancelled'    — (reserved, Day 3+)

ALTER TABLE fix_jobs ADD COLUMN ended_reason TEXT;
