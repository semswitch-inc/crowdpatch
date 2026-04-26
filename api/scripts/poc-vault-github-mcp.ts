// POC: Anthropic Vaults + GitHub MCP for BYO push.
//
// Background: the shipped BYO-token slice proved that passing a user PAT as
// `github_repository.authorization_token` cleanly clones private repos but
// CANNOT push — Anthropic's git proxy at api.anthropic.com returns
// `401 Invalid GitHub source exchange token` for arbitrary BYO PATs.
//
// Hypothesis (per https://platform.claude.com/docs/en/managed-agents/vaults
// and .../mcp-connector): the intended pattern is to store the user's PAT
// in an Anthropic Vault bound to mcp_server_url=https://api.githubcopilot.com/mcp/,
// then start the session with vault_ids: [vault_id]. The agent uses GitHub
// MCP tool calls (create_branch, create_or_update_file, create_pull_request)
// for git operations — bypassing the broken git proxy entirely.
//
// This script proves the pattern end-to-end on a throwaway repo. NOT a
// CrowdPatch product integration; the worker / DO / web UI are untouched.
//
// Usage:
//   cd api
//   BYO_TEST_PAT='github_pat_…' \
//   BYO_TEST_REPO_URL='https://github.com/SemSwitch/demo' \
//   npm run poc:vault-mcp
//
// Reads ANTHROPIC_API_KEY + ANTHROPIC_ENVIRONMENT_ID from .dev.vars.
// Reads BYO_TEST_PAT + BYO_TEST_REPO_URL from process.env (never written to disk).
//
// Outputs evidence to .agents/evidence/byo-vault-poc/:
//   - vault_id.txt, agent_id.txt, session_id.txt
//   - transcript.jsonl (redacted; one event per line)
//   - pr_url.txt (success) OR failure_reason.txt (failure)
//   - summary.txt
//
// The script does NOT mutate the production ANTHROPIC_AGENT_ID. It creates a
// fresh POC agent per invocation (named with a timestamp suffix) so the
// production demo path stays untouched.

import Anthropic from "@anthropic-ai/sdk";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DEV_VARS_PATH = resolve(__dirname, "../.dev.vars");
const EVIDENCE_DIR = resolve(__dirname, "../../.agents/evidence/byo-vault-poc");

const GITHUB_MCP_URL = "https://api.githubcopilot.com/mcp/";
const MODEL = "claude-opus-4-6";
const SESSION_TIMEOUT_MS = 15 * 60_000; // 15 min — MCP tool round-trips can be chatty

// System prompt is intentionally tight. The point is to test the MCP path,
// not produce a polished agent. The "do NOT use shell git" instruction is
// critical — without it the model may fall back to shell git, which has no
// credentials inside the sandbox and reproduces the exact failure we're
// trying to bypass.
const POC_SYSTEM_PROMPT = `You are a proof-of-concept agent verifying that GitHub MCP tools work end-to-end.

The user will give you a repository URL and a tiny change to make. You have:
- A mounted clone of the repo at /workspace/repo (read-only path; use it to read files).
- GitHub MCP tools wired in via an Anthropic Vault. These let you create branches, write files, and open pull requests through the GitHub MCP server (api.githubcopilot.com/mcp/).

Strict rules:
1. Use the GitHub MCP tools for ALL write operations (branch creation, file writes, PR open). Look for tool names like create_branch, create_or_update_file, push_files, create_pull_request.
2. Do NOT use shell git push, git commit, or any shell command that requires git credentials — the sandbox has no git auth, only the MCP-injected token.
3. Make the smallest possible change that satisfies the user's request.
4. Open a pull request titled "[POC] vault+mcp test" with a short body explaining the change.
5. After the PR is open, output exactly: POC_DONE: <pr_url> and stop.

If a tool call fails, surface the exact tool name + error and stop. Do not silently retry shell git as a fallback.`;

type DevVars = Record<string, string>;

function parseDevVars(content: string): DevVars {
  const out: DevVars = {};
  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

function redact(s: string): string {
  return s
    .replace(/sk-ant-api03-[A-Za-z0-9_-]+/g, "sk-ant-api03-REDACTED")
    .replace(/github_pat_[A-Za-z0-9_]+/g, "github_pat_REDACTED")
    .replace(/(ghp_|ghs_|gho_|ghu_|ghr_)[A-Za-z0-9]+/g, "$1REDACTED")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/g, "Bearer REDACTED");
}

interface RepoCoords {
  owner: string;
  repo: string;
}

function parseRepoUrl(url: string): RepoCoords | null {
  const m =
    /^https:\/\/github\.com\/([^/?#\s]+)\/([^/?#\s]+?)(?:\.git)?\/?$/.exec(url);
  if (!m) return null;
  const [, owner, repo] = m;
  if (!owner || !repo) return null;
  return { owner, repo };
}

async function writeEvidence(name: string, body: string): Promise<void> {
  await mkdir(EVIDENCE_DIR, { recursive: true });
  await writeFile(resolve(EVIDENCE_DIR, name), body, "utf-8");
}

async function main() {
  // ── 1. Read .dev.vars + env ──────────────────────────────────────────────
  let devVarsContent: string;
  try {
    devVarsContent = await readFile(DEV_VARS_PATH, "utf-8");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`✘ Could not read api/.dev.vars (${redact(msg)}).`);
    process.exit(1);
  }
  const env = parseDevVars(devVarsContent);
  const apiKey = env.ANTHROPIC_API_KEY;
  const envId = env.ANTHROPIC_ENVIRONMENT_ID;
  const pat = process.env.BYO_TEST_PAT ?? "";
  const repoUrl = process.env.BYO_TEST_REPO_URL ?? "";

  if (!apiKey || apiKey.endsWith("REPLACE_ME")) {
    console.error("✘ ANTHROPIC_API_KEY missing in api/.dev.vars.");
    process.exit(1);
  }
  if (!envId) {
    console.error(
      "✘ ANTHROPIC_ENVIRONMENT_ID missing in api/.dev.vars (run npm run bootstrap:anthropic first).",
    );
    process.exit(1);
  }
  if (!pat) {
    console.error(
      "✘ BYO_TEST_PAT env var not set. Provide a fresh fine-grained GitHub PAT.",
    );
    process.exit(1);
  }
  const coords = parseRepoUrl(repoUrl);
  if (!repoUrl || !coords) {
    console.error(
      "✘ BYO_TEST_REPO_URL env var missing or not a valid github.com URL.",
    );
    process.exit(1);
  }

  const client = new Anthropic({ apiKey });
  const runSuffix = String(Date.now()).slice(-8);

  console.log(`→ POC run suffix: ${runSuffix}`);
  console.log(`  target repo: ${coords.owner}/${coords.repo}`);
  console.log(`  GitHub MCP:  ${GITHUB_MCP_URL}`);

  // ── 2. Create a vault ────────────────────────────────────────────────────
  console.log("→ Creating Anthropic Vault…");
  const vault = await client.beta.vaults.create({
    display_name: `crowdpatch-poc-${runSuffix}`,
    metadata: { project: "crowdpatch", purpose: "vault-mcp-poc" },
  });
  console.log(`  ✓ vault.id = ${vault.id}`);
  await writeEvidence("vault_id.txt", `${vault.id}\n`);

  // ── 3. Add static_bearer credential bound to GitHub MCP URL ──────────────
  console.log(`→ Adding static_bearer credential bound to ${GITHUB_MCP_URL}…`);
  const credential = await client.beta.vaults.credentials.create(vault.id, {
    display_name: `github_pat for ${coords.owner}/${coords.repo}`,
    auth: {
      type: "static_bearer",
      mcp_server_url: GITHUB_MCP_URL,
      token: pat,
    },
    metadata: { project: "crowdpatch", purpose: "vault-mcp-poc" },
  });
  console.log(`  ✓ credential.id = ${credential.id}`);

  // ── 4. Create a fresh POC agent with GitHub MCP + always_allow ───────────
  console.log("→ Creating POC agent with GitHub MCP toolset…");
  const agent = await client.beta.agents.create({
    name: `crowdpatch-poc-vault-mcp-${runSuffix}`,
    model: MODEL,
    system: POC_SYSTEM_PROMPT,
    description:
      "POC agent — proves Vaults + GitHub MCP unblock BYO push by routing git ops through MCP tools instead of the Anthropic git proxy.",
    mcp_servers: [
      {
        type: "url",
        name: "github",
        url: GITHUB_MCP_URL,
      },
    ],
    // always_allow on both toolsets so the agent can self-execute tool calls
    // without per-call human approval (the SDK default is always_ask).
    tools: [
      {
        type: "agent_toolset_20260401",
        default_config: {
          enabled: true,
          permission_policy: { type: "always_allow" },
        },
      },
      {
        type: "mcp_toolset",
        mcp_server_name: "github",
        default_config: {
          enabled: true,
          permission_policy: { type: "always_allow" },
        },
      },
    ],
    metadata: { project: "crowdpatch", role: "poc-vault-mcp" },
  });
  console.log(`  ✓ agent.id = ${agent.id}`);
  await writeEvidence("agent_id.txt", `${agent.id}\n`);

  // ── 5. Create session with vault binding + repo mount ────────────────────
  console.log("→ Creating session with vault_ids + github_repository mount…");
  const session = await client.beta.sessions.create({
    agent: agent.id,
    environment_id: envId,
    vault_ids: [vault.id],
    resources: [
      {
        type: "github_repository",
        url: repoUrl,
        authorization_token: pat, // for clone (read)
        mount_path: "/workspace/repo",
      },
    ],
    title: `poc-vault-mcp ${runSuffix}`,
    metadata: { project: "crowdpatch", role: "poc-vault-mcp" },
  });
  console.log(`  ✓ session.id = ${session.id}`);
  await writeEvidence("session_id.txt", `${session.id}\n`);

  // ── 6. Send user message + stream events ─────────────────────────────────
  const userMessage = `Bring-your-own POC test against ${coords.owner}/${coords.repo}.

Task: append a new line "POC ${runSuffix} reached here" to a file at the repo root named POC_PROOF.md (create it if it doesn't exist), open a pull request titled "[POC] vault+mcp test" with a one-line body, then output POC_DONE: <pr_url> and stop.

Use GitHub MCP tools for the file write and PR open — the sandbox has no shell git credentials.`;

  console.log("→ Streaming session events (timeout 15min)…");
  const transcriptLines: string[] = [];
  let prUrlFromAgent = "";
  let endReason: string | undefined;
  let mcpToolCallSeen = false;
  let mcpServerErrorSeen = false;

  try {
    const stream = await client.beta.sessions.events.stream(session.id);
    await client.beta.sessions.events.send(session.id, {
      events: [
        {
          type: "user.message",
          content: [{ type: "text", text: userMessage }],
        },
      ],
    });

    const timeout = new Promise<never>((_resolve, reject) => {
      setTimeout(() => {
        reject(
          new Error(`session timeout (${String(SESSION_TIMEOUT_MS / 1000)}s)`),
        );
      }, SESSION_TIMEOUT_MS);
    });

    const drain = (async () => {
      for await (const event of stream) {
        // Persist every event (redacted) for the evidence bundle. The SDK
        // shape is wide; we serialize the whole object opaquely.
        const line = redact(JSON.stringify(event));
        transcriptLines.push(line);
        // Live console output, truncated for readability.
        const truncated = line.length > 280 ? `${line.slice(0, 280)}…` : line;
        console.log(`  event: ${truncated}`);

        // Lightweight typing for control-flow + diagnostics. The SDK union is
        // wide; we only inspect the fields we care about.
        const e = event as {
          type?: string;
          stop_reason?: { type?: string };
          error?: { message?: string };
          mcp_server_name?: string;
          is_error?: boolean;
          content?: Array<{ type?: string; text?: string }>;
        };

        if (e.type === "agent.message" && Array.isArray(e.content)) {
          for (const block of e.content) {
            const text = block.text ?? "";
            // POC_DONE: <pr_url> sentinel from the system prompt.
            const m = /POC_DONE:\s*(\S+)/.exec(text);
            const captured = m?.[1];
            if (captured && !prUrlFromAgent) {
              prUrlFromAgent = captured;
              console.log(`  ★ agent reported PR url: ${prUrlFromAgent}`);
            }
          }
        }
        // Verified from a successful POC run (vault_011CaSu7KcXeLz2o9E6dqWjD):
        // MCP tool calls land as `agent.mcp_tool_use` with mcp_server_name set.
        // Their results land as `agent.mcp_tool_result` with is_error to signal
        // server-side failures (e.g., a 401 from the MCP backend).
        if (e.type === "agent.mcp_tool_use" && e.mcp_server_name === "github") {
          mcpToolCallSeen = true;
        }
        if (e.type === "agent.mcp_tool_result" && e.is_error === true) {
          mcpServerErrorSeen = true;
        }
        if (e.type === "session.status_idle") {
          endReason = e.stop_reason?.type ?? "idle";
          break;
        }
        if (e.type === "session.status_terminated") {
          endReason = "terminated";
          break;
        }
        if (e.type === "session.error") {
          endReason = `error: ${e.error?.message ?? "unknown"}`;
          break;
        }
      }
    })();

    await Promise.race([drain, timeout]);
  } finally {
    await writeEvidence("transcript.jsonl", `${transcriptLines.join("\n")}\n`);
    try {
      await client.beta.sessions.archive(session.id);
    } catch {
      // best-effort cleanup
    }
  }

  console.log(`→ Session ended. reason=${endReason ?? "(none)"}`);

  // ── 7. Verify PR independently via GitHub API ────────────────────────────
  console.log("→ Verifying PR exists on GitHub via direct API call…");
  let verifiedPrUrl: string | null = null;
  try {
    const prsRes = await fetch(
      `https://api.github.com/repos/${coords.owner}/${coords.repo}/pulls?state=open&per_page=20`,
      {
        headers: {
          Authorization: `Bearer ${pat}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
      },
    );
    if (prsRes.ok) {
      const prs = (await prsRes.json()) as Array<{
        title: string;
        html_url: string;
        number: number;
        head: { ref: string };
      }>;
      const pocPr = prs.find((p) => p.title.startsWith("[POC]"));
      if (pocPr) {
        verifiedPrUrl = pocPr.html_url;
        console.log(
          `  ✓ PR #${String(pocPr.number)} on branch ${pocPr.head.ref}: ${pocPr.html_url}`,
        );
      } else {
        console.log("  ✘ no [POC]-titled PR found in open PRs.");
      }
    } else {
      console.log(`  ✘ GitHub API responded ${String(prsRes.status)}.`);
    }
  } catch (err) {
    console.log(
      `  ✘ GitHub verification failed: ${redact(
        err instanceof Error ? err.message : String(err),
      )}`,
    );
  }

  // ── 8. Final summary + evidence ──────────────────────────────────────────
  const success = Boolean(verifiedPrUrl);
  const summaryLines = [
    `POC: Vaults + GitHub MCP — run ${runSuffix}`,
    `repo:                ${coords.owner}/${coords.repo}`,
    `vault.id:            ${vault.id}`,
    `agent.id:            ${agent.id}`,
    `session.id:          ${session.id}`,
    `end_reason:          ${endReason ?? "(none)"}`,
    `agent_reported_pr:   ${prUrlFromAgent || "(none)"}`,
    `verified_pr_url:     ${verifiedPrUrl ?? "(none)"}`,
    `mcp_tool_call_seen:  ${String(mcpToolCallSeen)}`,
    `mcp_server_error:    ${String(mcpServerErrorSeen)}`,
    `outcome:             ${success ? "✅ SUCCESS" : "❌ FAILURE"}`,
  ];
  await writeEvidence("summary.txt", `${summaryLines.join("\n")}\n`);
  if (verifiedPrUrl) {
    await writeEvidence("pr_url.txt", `${verifiedPrUrl}\n`);
  } else {
    await writeEvidence(
      "failure_reason.txt",
      [
        `end_reason: ${endReason ?? "(none)"}`,
        `agent_reported_pr: ${prUrlFromAgent || "(none)"}`,
        `mcp_tool_call_seen: ${String(mcpToolCallSeen)}`,
        `mcp_server_error: ${String(mcpServerErrorSeen)}`,
        "",
        "See transcript.jsonl for the full event stream (redacted).",
      ].join("\n"),
    );
  }

  console.log("");
  console.log(summaryLines.map((l) => `  ${l}`).join("\n"));
  console.log("");
  console.log(`Evidence saved to: ${EVIDENCE_DIR}`);

  if (!success) process.exit(2);
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? (err.stack ?? err.message) : String(err);
  console.error("✘ POC failed:");
  console.error(redact(msg));
  process.exit(1);
});
