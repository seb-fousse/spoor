import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Core logic is pure and runs in plain Node. No browser/jsdom needed.
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
