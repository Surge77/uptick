import { describe, expect, it } from "vitest";
import { foldRegion, foldRegions } from "./region.js";
import { DEFAULT_VERDICT_POLICY, type Observation, type VerdictPolicy } from "./types.js";

const BASE = new Date("2026-01-01T00:00:00Z").getTime();
const policy: VerdictPolicy = { ...DEFAULT_VERDICT_POLICY };

/** Build an observation `n` minutes after the base instant. */
function obs(n: number, ok: boolean, latencyMs: number | null = 100, region = "fra"): Observation {
  return { regionSlug: region, ts: new Date(BASE + n * 60_000), ok, latencyMs };
}

describe("foldRegion", () => {
  it("reports PENDING with no observations", () => {
    const result = foldRegion("fra", [], policy);
    expect(result.state).toBe("PENDING");
    expect(result.lastObservedAt).toBeNull();
  });

  it("reports PENDING before the recovery threshold is met", () => {
    // One success is not yet enough to conclude the target is healthy.
    expect(foldRegion("fra", [obs(0, true)], policy).state).toBe("PENDING");
  });

  it("reports UP once the recovery threshold is met", () => {
    const result = foldRegion("fra", [obs(0, true), obs(1, true)], policy);
    expect(result.state).toBe("UP");
    expect(result.consecutiveSuccesses).toBe(2);
  });

  it("does not report DOWN on a single failure", () => {
    // The single most important behavior in the system: one blipped probe is
    // usually the prober's network, not the target.
    const result = foldRegion("fra", [obs(0, true), obs(1, true), obs(2, false)], policy);
    expect(result.state).not.toBe("DOWN");
    expect(result.consecutiveFailures).toBe(1);
  });

  it("does not report DOWN one probe short of the threshold", () => {
    const result = foldRegion("fra", [obs(0, false), obs(1, false)], policy);
    expect(result.state).toBe("PENDING");
    expect(result.consecutiveFailures).toBe(2);
  });

  it("reports DOWN exactly at the confirmation threshold", () => {
    const result = foldRegion("fra", [obs(0, false), obs(1, false), obs(2, false)], policy);
    expect(result.state).toBe("DOWN");
    expect(result.consecutiveFailures).toBe(3);
  });

  it("counts only the trailing run, not historical failures", () => {
    // Failures from an hour ago must not accumulate toward the threshold.
    const result = foldRegion(
      "fra",
      [obs(0, false), obs(1, false), obs(2, true), obs(3, true)],
      policy,
    );
    expect(result.state).toBe("UP");
    expect(result.consecutiveFailures).toBe(0);
    expect(result.consecutiveSuccesses).toBe(2);
  });

  it("resets the success run when a failure arrives", () => {
    const result = foldRegion("fra", [obs(0, true), obs(1, true), obs(2, false)], policy);
    expect(result.consecutiveSuccesses).toBe(0);
    expect(result.consecutiveFailures).toBe(1);
  });

  it("captures the latest error when failing", () => {
    const result = foldRegion(
      "fra",
      [
        { ...obs(0, false), error: "ECONNREFUSED" },
        { ...obs(1, false), error: "ETIMEDOUT" },
        { ...obs(2, false), error: "ETIMEDOUT" },
      ],
      policy,
    );
    expect(result.lastError).toBe("ETIMEDOUT");
  });

  it("clears the error once healthy", () => {
    const result = foldRegion(
      "fra",
      [{ ...obs(0, false), error: "ECONNREFUSED" }, obs(1, true), obs(2, true)],
      policy,
    );
    expect(result.lastError).toBeNull();
  });

  describe("degraded detection", () => {
    it("does not degrade on a single slow response", () => {
      const result = foldRegion("fra", [obs(0, true, 100), obs(1, true, 5000)], policy);
      expect(result.state).toBe("UP");
    });

    it("degrades once slowness is as established as an outage would be", () => {
      const result = foldRegion(
        "fra",
        [obs(0, true, 5000), obs(1, true, 5000), obs(2, true, 5000)],
        policy,
      );
      expect(result.state).toBe("DEGRADED");
    });

    it("stays UP when latency sits exactly on the threshold", () => {
      // degradedMs is an exclusive bound: 2000ms is acceptable, 2001ms is not.
      const at = policy.degradedMs!;
      const result = foldRegion(
        "fra",
        [obs(0, true, at), obs(1, true, at), obs(2, true, at)],
        policy,
      );
      expect(result.state).toBe("UP");
    });

    it("ignores latency entirely when degradedMs is null", () => {
      const noDegraded: VerdictPolicy = { ...policy, degradedMs: null };
      const result = foldRegion(
        "fra",
        [obs(0, true, 99_999), obs(1, true, 99_999), obs(2, true, 99_999)],
        noDegraded,
      );
      expect(result.state).toBe("UP");
    });

    it("prefers DOWN over DEGRADED when both could apply", () => {
      const result = foldRegion(
        "fra",
        [obs(0, true, 5000), obs(1, false), obs(2, false), obs(3, false)],
        policy,
      );
      expect(result.state).toBe("DOWN");
    });

    it("stops scanning for slowness at an older failure", () => {
      // The trailing run is healthy but a failure sits behind it. The slow-scan
      // must stop there rather than walking into pre-recovery history.
      const result = foldRegion(
        "fra",
        [obs(0, false), obs(1, true, 5000), obs(2, true, 5000)],
        policy,
      );
      expect(result.state).toBe("UP");
      expect(result.consecutiveSuccesses).toBe(2);
    });

    it("treats a null latency as not slow", () => {
      const result = foldRegion(
        "fra",
        [obs(0, true, null), obs(1, true, null), obs(2, true, null)],
        policy,
      );
      expect(result.state).toBe("UP");
    });
  });
});

describe("foldRegions", () => {
  it("returns nothing for no observations", () => {
    expect(foldRegions([], policy)).toEqual([]);
  });

  it("evaluates each region independently", () => {
    // fra is down, iad is healthy. Merging the streams would let fra's three
    // failures satisfy the threshold on behalf of the whole monitor.
    const result = foldRegions(
      [
        obs(0, false, 100, "fra"),
        obs(1, false, 100, "fra"),
        obs(2, false, 100, "fra"),
        obs(0, true, 100, "iad"),
        obs(1, true, 100, "iad"),
      ],
      policy,
    );

    expect(result).toHaveLength(2);
    expect(result.find((r) => r.regionSlug === "fra")!.state).toBe("DOWN");
    expect(result.find((r) => r.regionSlug === "iad")!.state).toBe("UP");
  });

  it("orders observations by time regardless of input order", () => {
    const result = foldRegions([obs(2, true), obs(0, false), obs(1, true)], policy);
    expect(result[0]!.state).toBe("UP");
    expect(result[0]!.consecutiveSuccesses).toBe(2);
  });

  it("returns regions in a stable alphabetical order", () => {
    const result = foldRegions(
      [obs(0, true, 100, "sin"), obs(0, true, 100, "fra"), obs(0, true, 100, "iad")],
      policy,
    );
    expect(result.map((r) => r.regionSlug)).toEqual(["fra", "iad", "sin"]);
  });
});
