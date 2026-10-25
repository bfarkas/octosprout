import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Test against core's source so tests don't depend on a prior build.
    alias: {
      "@octosprout/core": fileURLToPath(new URL("./packages/core/src/index.ts", import.meta.url)),
    },
  },
  test: {
    include: ["packages/*/src/**/*.test.ts"],
  },
});
