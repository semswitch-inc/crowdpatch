// POST /api/apps — register a new app row from an uploader submission.
//
// Mirrors bugReports.ts in shape: Hono + zValidator with the default
// { success: false, error } 400 response, single-statement INSERT.
//
// Differences worth flagging:
//   * `owner_user_id` is HARDCODED server-side and is NOT in the public
//     request contract. There is no per-judge user creation and no auth in
//     scope. Pre-flight Gate A verifies the seeded `user_uploader_hassan`
//     row exists in remote D1 before any deploy.
//   * `github_repo_url` validation reuses parseRepoUrl() from lib/github so
//     the route can never accept a URL the agent pipeline later rejects.
//   * `setup_commands`, `test_commands`, `agent_notes` are normalized to
//     null when missing or whitespace-only — preserves the
//     agentPrompt.ts:26-28 fallback chain (npm install / npm test / no
//     notes block). Empty strings would defeat those fallbacks.

import { Hono } from "hono";
import { ulid } from "ulid";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";

import type { Bindings } from "../index";
import { createApp } from "../lib/db";
import { parseRepoUrl } from "../lib/github";

const apps = new Hono<{ Bindings: Bindings }>();

const OWNER_USER_ID = "user_uploader_hassan";

const PostBody = z.object({
  display_name: z.string().min(1).max(80),
  github_repo_url: z
    .string()
    .min(1)
    .max(255)
    .refine((url) => parseRepoUrl(url) !== null, {
      message: "must be a valid github.com repo URL",
    }),
  default_branch: z.string().min(1).max(80),
  setup_commands: z.string().max(500).optional(),
  test_commands: z.string().max(500).optional(),
  agent_notes: z.string().max(4000).optional(),
});

apps.post("/apps", zValidator("json", PostBody), async (c) => {
  const body = c.req.valid("json");

  const id = `app_${ulid().toLowerCase()}`;

  await createApp(c.env.DB, {
    id,
    owner_user_id: OWNER_USER_ID,
    github_repo_url: body.github_repo_url,
    display_name: body.display_name,
    default_branch: body.default_branch,
    setup_commands: body.setup_commands?.trim() || null,
    test_commands: body.test_commands?.trim() || null,
    agent_notes: body.agent_notes?.trim() || null,
  });

  return c.json(
    {
      app_id: id,
      display_name: body.display_name,
      github_repo_url: body.github_repo_url,
      default_branch: body.default_branch,
    },
    201,
  );
});

export default apps;
