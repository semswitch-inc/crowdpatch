// Subset of bug_reports row carried client-side after the user submits the
// form. The server returns just the new id; the form already has the rest in
// state, so we hand the parent the full snapshot to render the SubmittedBugCard
// without an extra GET.

export interface SubmittedBug {
  id: string;
  title: string;
  description: string;
  reporter_name: string;
  severity: "low" | "medium" | "high";
}
