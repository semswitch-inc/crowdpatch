// Subset of the apps row carried client-side after the user submits the
// app-submission form. Server returns `{ app_id }` on POST /api/apps; the
// AppSubmissionForm submit handler does an EXPLICIT field rename to `id` so
// downstream components match the SubmittedBug.id convention. See
// api/src/routes/apps.ts for the server-side response shape.

export interface ConnectedApp {
  id: string;
  display_name: string;
  github_repo_url: string;
  default_branch: string;
}
