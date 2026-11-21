import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    testTimeout: 15000,
    hookTimeout: 15000,
    fileParallelism: false,
    include: ["src/**/*.test.ts", "client/src/**/*.test.ts", "tests/**/*.test.ts"],
  },
});
