import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      { test: { name: "unit", include: ["packages/*/test/**/*.test.ts"] } },
      // Integration suites hit the live backroom-test project; credentials come from .env.test.
      { test: { name: "integration", include: ["tests/**/*.int.test.ts"], testTimeout: 60_000, hookTimeout: 180_000, fileParallelism: false } },
    ],
  },
});
