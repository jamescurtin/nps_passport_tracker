import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // e2e/*.spec.js are Playwright tests (npm run test:e2e).
    include: ["test/**/*.test.js"],
  },
});
