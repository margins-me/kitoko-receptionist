import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // server-only throws outside a react-server bundle; tests run in plain Node.
    alias: { "server-only": fileURLToPath(new URL("node_modules/server-only/empty.js", import.meta.url)) },
  },
  test: {
    projects: [
      { extends: true, test: { name: "unit", dir: "test" } },
      {
        extends: true,
        // against the local stack (pnpm db:start); files share its data, so they run one at a time
        test: { name: "int", dir: "test-int", globalSetup: "test-int/setup.ts", fileParallelism: false, testTimeout: 20_000 },
      },
    ],
  },
});
