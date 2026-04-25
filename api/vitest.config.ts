import {
  cloudflareTest,
  readD1Migrations,
} from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

// Read D1 migrations once at config-load time and pass them through to the
// Workers test runtime as a binding (TEST_MIGRATIONS). Tests that need a
// fresh-schema DB call applyD1Migrations(env.DB, env.TEST_MIGRATIONS) in
// beforeAll. Avoids hardcoding the schema in test files.
const migrations = await readD1Migrations("./migrations");

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.toml" },
      miniflare: {
        bindings: { TEST_MIGRATIONS: migrations },
      },
    }),
  ],
});
