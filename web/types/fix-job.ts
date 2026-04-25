// Mirror of the GET /api/fix-jobs/:id payload shape.
//
// Fields are roughly grouped: identity / status, agent + environment audit
// trail, cumulative session usage (post-finally retrieve), first-request
// usage (per-event capture in the DO), timestamps, cost.
//
// All token / cache numbers are nullable: the DO writes them inside the
// finally block AFTER the terminal SSE has been broadcast. The web client
// polls with backoff (web/lib/fixJobs.ts) to bridge that race; if the cap
// is hit the field stays null and the chip renders `—`.

export interface FixJobSummary {
  id: string;
  status: string;
  branch_name: string | null;
  pr_url: string | null;
  ended_reason: string | null;

  agent_variant: string | null;
  anthropic_agent_id: string | null;
  anthropic_environment_id: string | null;
  anthropic_agent_model: string | null;
  anthropic_agent_version: string | null;
  anthropic_session_id: string | null;

  total_input_tokens: number | null;
  total_output_tokens: number | null;
  total_cache_creation_input_tokens: number | null;
  total_cache_read_input_tokens: number | null;

  first_input_tokens: number | null;
  first_output_tokens: number | null;
  first_cache_creation_input_tokens: number | null;
  first_cache_read_input_tokens: number | null;

  started_at: number | null;
  completed_at: number | null;
  cost_credits: number;

  // R2 evidence-bundle manifest (migration 0006). Returned as the raw JSON
  // string from GET /api/fix-jobs/:id (matches the result_summary_json
  // convention). Null until the first artifact write completes; null on rows
  // pre-dating the R2 slice. Parse with JSON.parse if you need to inspect the
  // entries; no UI consumes it today.
  artifact_manifest_json: string | null;
}
