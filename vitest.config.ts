import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Vitest 4 no longer excludes dist/ by default. tsc compiles the tests
    // into dist/, and running both copies at once races the integration
    // tests over their shared temp dir.
    include: ["src/**/*.test.ts"],
  },
});
