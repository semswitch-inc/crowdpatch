// POST /api/bug-reports — create a new bug report row from a user submission.
//
// Defaults app_id to 'app_jsdiff_demo' so the form on / can submit without
// the caller knowing about apps yet (multi-app upload is a future slice).
// Self-hosters / scripts can still pass app_id explicitly.
//
// Validation failures return Hono+Zod's default { success: false, error }
// shape (matching fixJobs.ts). FK guard via explicit getApp() for a clean
// 422 instead of letting SQLITE_CONSTRAINT bubble to a 500.

import { Hono } from "hono";
import { ulid } from "ulid";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";

import type { Bindings } from "../index";
import { createBugReport, getApp } from "../lib/db";

const bugReports = new Hono<{ Bindings: Bindings }>();

const DEFAULT_APP_ID = "app_jsdiff_demo";

const PostBody = z.object({
  title: z.string().min(1).max(120),
  description: z.string().min(1).max(2000),
  reporter_name: z.string().min(1).max(80),
  severity: z.enum(["low", "medium", "high"]),
  app_id: z.string().min(1).max(80).optional(),
});

bugReports.post("/bug-reports", zValidator("json", PostBody), async (c) => {
  const body = c.req.valid("json");
  const appId = body.app_id ?? DEFAULT_APP_ID;

  const app = await getApp(c.env.DB, appId);
  if (!app) {
    return c.json({ error: "app not found", app_id: appId }, 422);
  }

  const id = `bug_${ulid().toLowerCase()}`;

  await createBugReport(c.env.DB, {
    id,
    app_id: appId,
    reporter_name: body.reporter_name,
    title: body.title,
    description: body.description,
    severity: body.severity,
  });

  return c.json({ bug_report_id: id, app_id: appId }, 201);
});

export default bugReports;
