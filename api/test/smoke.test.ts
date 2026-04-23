/* eslint-disable @typescript-eslint/no-deprecated --
 * SELF is the documented entrypoint for @cloudflare/vitest-pool-workers smoke tests.
 * The replacement (`import { exports } from "cloudflare:workers"`) requires
 * Cloudflare.Exports to be populated by `wrangler types`, which we don't run in CI.
 * Revisit when wrangler typegen for module exports stabilizes.
 */
import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import Anthropic from "@anthropic-ai/sdk";

interface HealthResponse {
  name: string;
  status: string;
}

describe("worker health endpoints", () => {
  it("GET /health returns ok", async () => {
    const res = await SELF.fetch("https://example.com/health");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");
  });

  it("GET / returns health JSON", async () => {
    const res = await SELF.fetch("https://example.com/");
    expect(res.status).toBe(200);
    const body = await res.json<HealthResponse>();
    expect(body.name).toBe("crowdpatch-api");
    expect(body.status).toBe("healthy");
  });
});

describe("@anthropic-ai/sdk Managed Agents surface", () => {
  it("exposes client.beta.agents / sessions / environments in Workers runtime", () => {
    const client = new Anthropic({ apiKey: "test-key-not-used" });
    expect(typeof client.beta.agents.create).toBe("function");
    expect(typeof client.beta.agents.retrieve).toBe("function");
    expect(typeof client.beta.sessions.create).toBe("function");
    expect(typeof client.beta.environments.create).toBe("function");
  });
});
