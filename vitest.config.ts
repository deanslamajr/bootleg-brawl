import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "packages/**/test/**/*.test.ts",
      "tests/unit/**/*.test.ts",
      "tests/replay/**/*.test.ts",
      "tests/content/**/*.test.ts",
    ],
    environment: "node",
    testTimeout: 60_000,
  },
});
