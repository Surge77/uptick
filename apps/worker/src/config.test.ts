import { describe, expect, it } from "vitest";
import { ConfigError, DEFAULTS, loadConfig } from "./config.js";

const base = { REGION: "fra" } as NodeJS.ProcessEnv;

describe("loadConfig", () => {
  it("applies defaults when only REGION is set", () => {
    const config = loadConfig(base);
    expect(config.region).toBe("fra");
    expect(config.tickMs).toBe(DEFAULTS.tickMs);
    expect(config.concurrency).toBe(DEFAULTS.concurrency);
    expect(config.batchSize).toBe(DEFAULTS.batchSize);
  });

  it("requires REGION", () => {
    // A worker probing as the wrong region corrupts quorum: two instances both
    // reporting as "fra" look like agreement when they are one machine.
    expect(() => loadConfig({})).toThrow(ConfigError);
  });

  it("rejects a blank REGION", () => {
    expect(() => loadConfig({ REGION: "   " })).toThrow(ConfigError);
  });

  it("trims REGION", () => {
    expect(loadConfig({ REGION: " iad " }).region).toBe("iad");
  });

  it("reads overrides from the environment", () => {
    const config = loadConfig({
      ...base,
      WATCH_TICK_MS: "5000",
      WATCH_CONCURRENCY: "10",
      WATCH_BATCH_SIZE: "100",
    });
    expect(config.tickMs).toBe(5000);
    expect(config.concurrency).toBe(10);
    expect(config.batchSize).toBe(100);
  });

  it("treats an empty override as absent", () => {
    expect(loadConfig({ ...base, WATCH_TICK_MS: "" }).tickMs).toBe(DEFAULTS.tickMs);
  });

  const invalid = ["0", "-1", "abc", "1.5"];

  it.each(invalid)("rejects %s as a tick interval", (value) => {
    expect(() => loadConfig({ ...base, WATCH_TICK_MS: value })).toThrow(ConfigError);
  });

  it("rejects a batch smaller than the concurrency limit", () => {
    // A batch the pool cannot absorb in one tick only lengthens the lease hold,
    // delaying other workers without adding throughput.
    expect(() => loadConfig({ ...base, WATCH_BATCH_SIZE: "10", WATCH_CONCURRENCY: "50" })).toThrow(
      ConfigError,
    );
  });

  it("allows a batch equal to the concurrency limit", () => {
    expect(loadConfig({ ...base, WATCH_BATCH_SIZE: "50", WATCH_CONCURRENCY: "50" }).batchSize).toBe(
      50,
    );
  });
});
