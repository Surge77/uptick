import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      // Excluded because a unit test against a fake would prove nothing about
      // them, and both ARE verified — just not here:
      //  - adapters/**  thin wrappers over Node sockets and undici
      //  - watch/lease  raw SQL whose guarantee is a property of Postgres row
      //                 locking; proven by scripts/diag-lease.ts against a real
      //                 database, which is the only thing that can prove it
      //  - main.ts      process wiring and signal handling
      exclude: [
        "src/**/*.test.ts",
        "src/main.ts",
        // transport.ts IS covered, by transport.integration.test.ts
        "src/adapters/resolver.ts",
        "src/adapters/socket.ts",
        "src/watch/lease.ts",
        // Prisma access only. Their behaviour is proven end-to-end by
        // scripts/diag-incidents.ts against a real database; asserting them
        // against a mocked client would only test the mock.
        "src/incidents/store.ts",
        "src/incidents/pipeline.ts",
        "src/jobs/ledger.ts",
        "src/jobs/heartbeat-store.ts",
        "src/herald/dispatcher.ts",
        // Same category: loads the dependency graph and open incidents, then
        // hands both to suppressIncidents in @uptick/core, which is where the
        // actual decision lives and is tested exhaustively — cycles, diamonds,
        // non-overlapping outages. The suppression POLICY is covered here by
        // notify-policy.test.ts.
        "src/incidents/suppression-store.ts",
      ],
      reporter: ["text"],
      thresholds: { lines: 85, functions: 85, branches: 80, statements: 85 },
    },
  },
});
