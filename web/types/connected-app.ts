// Subset of the apps row carried client-side after the user submits the
// app-submission form. Server returns `{ app_id }` on POST /api/apps; the
// AppSubmissionForm submit handler does an EXPLICIT field rename to `id` so
// downstream components match the SubmittedBug.id convention. See
// api/src/routes/apps.ts for the server-side response shape.

// auth_mode is purely client-side state — it's chosen on the run-mode
// radio in AppSubmissionForm and never round-tripped through the apps
// row (no PAT lives on the server). 'demo_pat' = the bundled jsdiff path;
// 'user_pat' = bring-your-own GitHub PAT, prompted for on the fix step.
export interface ConnectedApp {
  id: string;
  display_name: string;
  github_repo_url: string;
  default_branch: string;
  auth_mode: "demo_pat" | "user_pat";
}
