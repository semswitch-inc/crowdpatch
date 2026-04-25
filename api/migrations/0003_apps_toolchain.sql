-- 0003_apps_toolchain.sql
-- Lift jsdiff-specific toolchain assumptions OUT of agentPrompt.ts and INTO
-- per-app seed data so the agent prompt becomes repo-agnostic. A judge or OSS
-- adopter can plug in their own repo by editing 4 strings + 1 SQL row.
--
-- default_branch: 'master' for jsdiff (legacy), 'main' for most modern repos.
--                 ALSO used as the PR base branch (durable_objects/agentSession.ts).
-- setup_commands: shell command(s) the agent runs to install deps.
--                 e.g. "corepack enable && yarn install --immutable"
-- test_commands:  shell command(s) the agent runs to validate the fix.
--                 e.g. "yarn test"
-- agent_notes:    free-form markdown for repo idiosyncrasies that don't fit
--                 the structured fields. Inlined verbatim into the agent
--                 prompt. Use sparingly — most repos won't need it.

ALTER TABLE apps ADD COLUMN default_branch TEXT NOT NULL DEFAULT 'main';
ALTER TABLE apps ADD COLUMN setup_commands TEXT;
ALTER TABLE apps ADD COLUMN test_commands TEXT;
ALTER TABLE apps ADD COLUMN agent_notes TEXT;
