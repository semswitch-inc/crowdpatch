import { describe, expect, it } from "vitest";

import {
  artifactKey,
  buildAgentPromptBody,
  buildAgentReplyTailBody,
  buildPrMetadataBody,
  buildRunSummaryBody,
  buildSubmittedBugBody,
  parsePrNumberFromUrl,
  type FixJobRow,
} from "../src/lib/artifacts";
import type { AppRow, BugReportRow } from "../src/lib/db";

function makeBug(overrides: Partial<BugReportRow> = {}): BugReportRow {
  return {
    id: "bug_001",
    app_id: "app_001",
    reporter_name: "alice",
    title: "tests fail",
    description: "the suite crashes",
    severity: "high",
    status: "open",
    created_at: 1_700_000_000,
    ...overrides,
  };
}

function makeApp(overrides: Partial<AppRow> = {}): AppRow {
  return {
    id: "app_001",
    owner_user_id: "user_uploader_hassan",
    github_repo_url: "https://github.com/owner/repo",
    display_name: "Demo App",
    default_branch: "main",
    setup_commands: null,
    test_commands: null,
    agent_notes: null,
    created_at: 1_700_000_000,
    ...overrides,
  };
}

function makeRow(overrides: Partial<FixJobRow> = {}): FixJobRow {
  return {
    id: "01HXYZ0000000000000000000Z",
    app_id: "app_001",
    bug_report_ids_json: JSON.stringify(["bug_001"]),
    status: "succeeded",
    ended_reason: "success",
    branch_name: "crowdpatch/01HXYZ",
    pr_url: "https://github.com/owner/repo/pull/42",
    commit_sha: "deadbeefcafebabe",
    cost_credits: 5,
    started_at: 1_700_000_000,
    completed_at: 1_700_000_120,
    result_summary_json: JSON.stringify({
      agent_reply_tail: "All tests pass.",
      pr_number: 42,
    }),
    prompt_snapshot_text: "Bug report from user...",
    anthropic_session_id: "sess_abc",
    anthropic_agent_id: "agent_b",
    anthropic_environment_id: "env_main",
    anthropic_agent_model: "claude-opus-4-6",
    anthropic_agent_version: "3",
    agent_variant: "B",
    first_input_tokens: 1000,
    first_output_tokens: 200,
    first_cache_creation_input_tokens: 800,
    first_cache_read_input_tokens: 0,
    total_input_tokens: 12345,
    total_output_tokens: 4567,
    total_cache_creation_input_tokens: 8910,
    total_cache_read_input_tokens: 3210,
    ...overrides,
  };
}

describe("buildSubmittedBugBody", () => {
  it("emits all six identity fields", () => {
    const built = buildSubmittedBugBody(makeBug());
    const parsed = JSON.parse(built.body) as Record<string, unknown>;
    expect(parsed.id).toBe("bug_001");
    expect(parsed.app_id).toBe("app_001");
    expect(parsed.title).toBe("tests fail");
    expect(parsed.description).toBe("the suite crashes");
    expect(parsed.severity).toBe("high");
    expect(parsed.reporter_name).toBe("alice");
    expect(built.contentType).toBe("application/json");
  });

  it("redacts secrets inside JSON string fields, not just .txt bodies", () => {
    const built = buildSubmittedBugBody(
      makeBug({
        description: "Found this token in logs: sk-ant-api03-XYZ123ABC456",
      }),
    );
    const parsed = JSON.parse(built.body) as Record<string, unknown>;
    expect(parsed.description).toBe(
      "Found this token in logs: sk-ant-api03-REDACTED",
    );
    // Title was unchanged in the input → still unchanged after redaction.
    expect(parsed.title).toBe("tests fail");
  });
});

describe("buildAgentPromptBody", () => {
  it("returns body + content type for a populated snapshot", () => {
    const built = buildAgentPromptBody("Step 1. cd /workspace/repo");
    expect(built).not.toBeNull();
    expect(built?.body).toBe("Step 1. cd /workspace/repo");
    expect(built?.contentType).toBe("text/plain; charset=utf-8");
  });

  it("returns null when the snapshot is null (artifact omitted)", () => {
    expect(buildAgentPromptBody(null)).toBeNull();
  });
});

describe("buildRunSummaryBody", () => {
  it("includes every documented field, preserving nulls", () => {
    const built = buildRunSummaryBody(
      makeRow({ commit_sha: null, total_input_tokens: null }),
    );
    const parsed = JSON.parse(built.body) as Record<string, unknown>;
    expect(parsed.fix_job_id).toBe("01HXYZ0000000000000000000Z");
    expect(parsed.status).toBe("succeeded");
    expect(parsed.commit_sha).toBeNull();
    expect(parsed.total_input_tokens).toBeNull();
    expect(parsed.cost_credits).toBe(5);
    expect(parsed.anthropic_agent_model).toBe("claude-opus-4-6");
  });
});

describe("buildPrMetadataBody", () => {
  it("returns parsed pr_number when pr_url is populated", () => {
    const built = buildPrMetadataBody(makeRow(), makeApp());
    if (built === null) throw new Error("expected non-null built artifact");
    const parsed = JSON.parse(built.body) as Record<string, unknown>;
    expect(parsed.pr_url).toBe("https://github.com/owner/repo/pull/42");
    expect(parsed.pr_number).toBe(42);
    expect(parsed.repo_url).toBe("https://github.com/owner/repo");
    expect(parsed.base_branch).toBe("main");
  });

  it("returns null when pr_url is null (failed run, no file written)", () => {
    expect(
      buildPrMetadataBody(makeRow({ pr_url: null }), makeApp()),
    ).toBeNull();
  });
});

describe("parsePrNumberFromUrl", () => {
  it("extracts the number from a valid GitHub PR URL", () => {
    expect(parsePrNumberFromUrl("https://github.com/owner/repo/pull/42")).toBe(
      42,
    );
  });

  it("returns null for non-PR URLs", () => {
    expect(parsePrNumberFromUrl("https://github.com/owner/repo")).toBeNull();
  });

  it("returns null for null input", () => {
    expect(parsePrNumberFromUrl(null)).toBeNull();
  });
});

describe("buildAgentReplyTailBody", () => {
  it("extracts agent_reply_tail from result_summary_json", () => {
    const built = buildAgentReplyTailBody(
      makeRow({
        result_summary_json: JSON.stringify({
          agent_reply_tail: "AGENT_DONE: branch-name",
        }),
      }),
    );
    expect(built).not.toBeNull();
    expect(built?.body).toBe("AGENT_DONE: branch-name");
    expect(built?.contentType).toBe("text/plain; charset=utf-8");
  });

  it("returns null when result_summary_json is null", () => {
    expect(
      buildAgentReplyTailBody(makeRow({ result_summary_json: null })),
    ).toBeNull();
  });

  it("returns null when result_summary_json lacks agent_reply_tail", () => {
    expect(
      buildAgentReplyTailBody(
        makeRow({ result_summary_json: JSON.stringify({ pr_number: 1 }) }),
      ),
    ).toBeNull();
  });
});

describe("artifactKey — deterministic key generation", () => {
  it("generates fix-jobs/<id>/<filename> exactly", () => {
    const id = "01HXYZ0000000000000000000Z";
    expect(artifactKey(id, "submitted-bug.json")).toBe(
      "fix-jobs/01HXYZ0000000000000000000Z/submitted-bug.json",
    );
    expect(artifactKey(id, "agent-prompt.txt")).toBe(
      "fix-jobs/01HXYZ0000000000000000000Z/agent-prompt.txt",
    );
    expect(artifactKey(id, "run-summary.json")).toBe(
      "fix-jobs/01HXYZ0000000000000000000Z/run-summary.json",
    );
    expect(artifactKey(id, "pr-metadata.json")).toBe(
      "fix-jobs/01HXYZ0000000000000000000Z/pr-metadata.json",
    );
    expect(artifactKey(id, "agent-reply-tail.txt")).toBe(
      "fix-jobs/01HXYZ0000000000000000000Z/agent-reply-tail.txt",
    );
  });
});
