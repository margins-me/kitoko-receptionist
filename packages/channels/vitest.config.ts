import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // server-only throws outside a react-server bundle; tests run in plain Node.
    alias: { "server-only": fileURLToPath(new URL("node_modules/server-only/empty.js", import.meta.url)) },
  },
});
