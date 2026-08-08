import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      // Adapters are thin wrappers over Node sockets; they are exercised by the
      // live diagnostic script rather than by unit tests against fakes.
      exclude: ["src/**/*.test.ts", "src/main.ts", "src/adapters/**"],
      reporter: ["text"],
      thresholds: { lines: 85, functions: 85, branches: 80, statements: 85 },
    },
  },
});
