// One-shot: provisions the Managed Agent + Environment used by /api/fix-jobs,
// runs a small streaming smoke test to verify the SDK iterator works end-to-end
// in Node, and prints the resulting IDs to paste into api/.dev.vars.
//
// Usage:
//   cd api && npm run bootstrap:anthropic
//
// Idempotency: refuses to run if ANTHROPIC_AGENT_ID or ANTHROPIC_ENVIRONMENT_ID
// is already populated (uncommented + non-empty) in .dev.vars. To re-bootstrap,
// comment those lines out first.
//
// Cost: agent + environment creation are free. The smoke test creates one
// short-lived session and sends one short message ("respond with OK"); a few
// hundred tokens of credit, then the session is archived.

import Anthropic from "@anthropic-ai/sdk";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DEV_VARS_PATH = resolve(__dirname, "../.dev.vars");

const AGENT_NAME = "crowdpatch-bug-fixer";
const ENVIRONMENT_NAME = "crowdpatch-default";
const MODEL = "claude-opus-4-7";

const SYSTEM_PROMPT = `You are CrowdPatch's repository maintenance agent.

Users submit bug reports for repositories they own or are authorized to patch. Your job is to inspect the mounted repository, understand the reported bug, make the smallest source change that resolves it, verify the change with the repository's test commands, commit the change, and push the requested branch.

You operate inside an isolated Claude Managed Agents sandbox. The repository is already mounted at /workspace/repo. Git authentication is already configured through the mounted repository resource. Do not inspect, print, modify, or troubleshoot credentials.

Responsibilities:
- Treat this as normal software maintenance on the submitted repository.
- Read source files as needed to understand the bug.
- Modify ordinary application or library source files when needed to resolve the reported bug.
- Keep the change narrow and directly related to the bug report.
- Do not refactor unrelated code.
- Run the requested setup and test commands.
- Commit with a clear conventional commit message.
- Push only the exact branch name provided in the user message.
- Do not open a pull request. CrowdPatch opens the PR after the branch is pushed.
- After pushing, output exactly: AGENT_DONE: <branch_name>

If you cannot install, test, edit, commit, or push, explain the specific blocker and stop.`;

const SMOKE_TIMEOUT_MS = 60_000;

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
    .replace(/(ghp_|ghs_|gho_)[A-Za-z0-9]+/g, "$1REDACTED");
}

async function main() {
  // 1. Read .dev.vars
  let devVarsContent: string;
  try {
    devVarsContent = await readFile(DEV_VARS_PATH, "utf-8");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`✘ Could not read api/.dev.vars (${redact(msg)}).`);
    console.error(
      "  Copy api/.dev.vars.example to api/.dev.vars and fill in ANTHROPIC_API_KEY first.",
    );
    process.exit(1);
  }

  const env = parseDevVars(devVarsContent);

  // 2. Validate ANTHROPIC_API_KEY
  if (!env.ANTHROPIC_API_KEY || env.ANTHROPIC_API_KEY.endsWith("REPLACE_ME")) {
    console.error(
      "✘ ANTHROPIC_API_KEY missing or still set to the placeholder in api/.dev.vars.",
    );
    process.exit(1);
  }

  // 3. Idempotency check
  if (env.ANTHROPIC_AGENT_ID || env.ANTHROPIC_ENVIRONMENT_ID) {
    console.error(
      "✘ ANTHROPIC_AGENT_ID and/or ANTHROPIC_ENVIRONMENT_ID are already set in api/.dev.vars.",
    );
    console.error(
      "  To re-bootstrap, comment those lines out (prefix each with '#') first.",
    );
    process.exit(1);
  }

  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

  // 4. Create the agent
  console.log(`→ Creating agent "${AGENT_NAME}" with model ${MODEL}…`);
  const agent = await client.beta.agents.create({
    name: AGENT_NAME,
    model: MODEL,
    system: SYSTEM_PROMPT,
    tools: [{ type: "agent_toolset_20260401" }],
    description:
      "CrowdPatch bug-fix agent — clones target repo, fixes a reported bug, runs tests, commits, pushes.",
    metadata: { project: "crowdpatch", role: "bug-fixer" },
  });
  console.log(`  ✓ agent.id = ${agent.id}`);

  // 5. Create the environment
  console.log(
    `→ Creating environment "${ENVIRONMENT_NAME}" (cloud / unrestricted networking)…`,
  );
  const environment = await client.beta.environments.create({
    name: ENVIRONMENT_NAME,
    config: {
      type: "cloud",
      networking: { type: "unrestricted" },
    },
    description:
      "CrowdPatch default environment — Node + git, network unrestricted (yarn registry, GitHub, etc.).",
    metadata: { project: "crowdpatch" },
  });
  console.log(`  ✓ environment.id = ${environment.id}`);

  // 6. Streaming smoke test — verifies `for await` over the SDK stream works
  //    in Node end-to-end. No GitHub mount, just a one-message session.
  console.log(
    "→ Streaming smoke test (creates a short-lived session, sends one message)…",
  );
  const smokeSession = await client.beta.sessions.create({
    agent: agent.id,
    environment_id: environment.id,
    title: "bootstrap smoke test",
    metadata: { project: "crowdpatch", purpose: "bootstrap-smoke" },
  });
  console.log(`  · session.id = ${smokeSession.id}`);

  let agentReplyText = "";
  let endReason: string | undefined;
  let sawRunning = false;

  try {
    const stream = await client.beta.sessions.events.stream(smokeSession.id);
    await client.beta.sessions.events.send(smokeSession.id, {
      events: [
        {
          type: "user.message",
          content: [
            {
              type: "text",
              text: "Respond with the exact single word OK and nothing else.",
            },
          ],
        },
      ],
    });

    const timeout = new Promise<never>((_resolve, reject) => {
      setTimeout(() => {
        reject(new Error("smoke test timeout (60s)"));
      }, SMOKE_TIMEOUT_MS);
    });

    const drain = (async () => {
      for await (const event of stream) {
        if (event.type === "session.status_running") {
          sawRunning = true;
        } else if (event.type === "agent.message") {
          for (const block of event.content) {
            agentReplyText += block.text;
          }
        } else if (event.type === "session.status_idle") {
          endReason = event.stop_reason.type;
          break;
        } else if (event.type === "session.status_terminated") {
          endReason = "terminated";
          break;
        } else if (event.type === "session.error") {
          endReason = `error: ${event.error.message}`;
          break;
        }
      }
    })();

    await Promise.race([drain, timeout]);
  } finally {
    // Best-effort cleanup; don't fail bootstrap if archive errors.
    try {
      await client.beta.sessions.archive(smokeSession.id);
    } catch {
      // ignore
    }
  }

  console.log(`  · saw session.status_running: ${String(sawRunning)}`);
  console.log(`  · end reason: ${endReason ?? "(none)"}`);
  console.log(
    `  · agent reply (trimmed): ${agentReplyText.trim().slice(0, 80) || "(empty)"}`,
  );

  if (endReason !== "end_turn" || !agentReplyText.trim()) {
    console.error(
      "✘ Smoke test did NOT complete with end_turn + a non-empty reply.",
    );
    console.error(
      "  Agent + environment WERE created (see IDs above) but the SDK streaming",
    );
    console.error(
      "  pattern is not behaving as expected. Investigate before building Step 2.",
    );
    process.exit(2);
  }

  console.log("  ✓ streaming smoke test passed.");

  // 7. Print paste-ready block
  console.log("");
  console.log("✓ Bootstrap complete. Add these two lines to api/.dev.vars:");
  console.log("");
  console.log(`ANTHROPIC_AGENT_ID=${agent.id}`);
  console.log(`ANTHROPIC_ENVIRONMENT_ID=${environment.id}`);
  console.log("");
  console.log("Then restart `wrangler dev` so the new vars are picked up.");
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? (err.stack ?? err.message) : String(err);
  console.error("✘ Bootstrap failed:");
  console.error(redact(msg));
  process.exit(1);
});
