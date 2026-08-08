import { describe, expect, it } from "vitest";
import {
  percentile,
  rollupAvailability,
  rollupByDay,
  utcDayStart,
  type CheckSample,
} from "./rollup.js";

function sample(iso: string, ok: boolean, latencyMs: number | null = 100): CheckSample {
  return { ts: new Date(iso), ok, latencyMs };
}

describe("percentile", () => {
  const sorted = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];

  const cases: Array<[number, number]> = [
    [0, 10],
    [10, 10],
    [50, 50],
    [95, 100],
    [99, 100],
    [100, 100],
  ];

  it.each(cases)("p%i of a ten-value set is %i", (p, expected) => {
    expect(percentile(sorted, p)).toBe(expected);
  });

  it("returns null for an empty set", () => {
    expect(percentile([], 95)).toBeNull();
  });

  it("returns the only value for a single-element set", () => {
    expect(percentile([42], 95)).toBe(42);
  });

  it("returns a value that actually occurred, never an interpolation", () => {
    // Nearest-rank is chosen precisely so every reported latency is one the
    // service really produced.
    expect(percentile([100, 200], 50)).toBe(100);
    expect(percentile([100, 200], 51)).toBe(200);
  });

  it("clamps percentiles outside 0-100", () => {
    expect(percentile(sorted, -5)).toBe(10);
    expect(percentile(sorted, 150)).toBe(100);
  });
});

describe("utcDayStart", () => {
  it("truncates to UTC midnight", () => {
    expect(utcDayStart(new Date("2026-03-15T13:45:22.123Z")).toISOString()).toBe(
      "2026-03-15T00:00:00.000Z",
    );
  });

  it("keeps a late-evening UTC timestamp on its own day", () => {
    // A local-time implementation would push this into the next or previous
    // day depending on the runner's timezone, making rollups machine-dependent.
    expect(utcDayStart(new Date("2026-03-15T23:59:59Z")).toISOString()).toBe(
      "2026-03-15T00:00:00.000Z",
    );
  });

  it("keeps an early-morning UTC timestamp on its own day", () => {
    expect(utcDayStart(new Date("2026-03-15T00:00:01Z")).toISOString()).toBe(
      "2026-03-15T00:00:00.000Z",
    );
  });
});

describe("rollupByDay", () => {
  it("returns nothing for no samples", () => {
    expect(rollupByDay([])).toEqual([]);
  });

  it("counts successes and totals", () => {
    const [rollup] = rollupByDay([
      sample("2026-01-01T01:00:00Z", true),
      sample("2026-01-01T02:00:00Z", true),
      sample("2026-01-01T03:00:00Z", false),
    ]);
    expect(rollup!.upCount).toBe(2);
    expect(rollup!.totalCount).toBe(3);
  });

  it("splits samples across UTC days", () => {
    const rollups = rollupByDay([
      sample("2026-01-01T23:00:00Z", true),
      sample("2026-01-02T01:00:00Z", true),
    ]);
    expect(rollups).toHaveLength(2);
    expect(rollups[0]!.day.toISOString()).toBe("2026-01-01T00:00:00.000Z");
    expect(rollups[1]!.day.toISOString()).toBe("2026-01-02T00:00:00.000Z");
  });

  it("returns days in chronological order regardless of input order", () => {
    const rollups = rollupByDay([
      sample("2026-01-03T01:00:00Z", true),
      sample("2026-01-01T01:00:00Z", true),
      sample("2026-01-02T01:00:00Z", true),
    ]);
    expect(rollups.map((r) => r.day.toISOString().slice(0, 10))).toEqual([
      "2026-01-01",
      "2026-01-02",
      "2026-01-03",
    ]);
  });

  it("computes latency statistics from successful checks", () => {
    const [rollup] = rollupByDay([
      sample("2026-01-01T01:00:00Z", true, 100),
      sample("2026-01-01T02:00:00Z", true, 200),
      sample("2026-01-01T03:00:00Z", true, 300),
    ]);
    expect(rollup!.minMs).toBe(100);
    expect(rollup!.maxMs).toBe(300);
    expect(rollup!.p50Ms).toBe(200);
  });

  it("excludes failed checks from latency statistics", () => {
    // A failed probe's latency is time spent failing. Mixing it into p95 makes
    // an outage look like a slowdown.
    const [rollup] = rollupByDay([
      sample("2026-01-01T01:00:00Z", true, 100),
      sample("2026-01-01T02:00:00Z", false, 30_000),
    ]);
    expect(rollup!.maxMs).toBe(100);
    expect(rollup!.totalCount).toBe(2);
    expect(rollup!.upCount).toBe(1);
  });

  it("reports null latency statistics when every check failed", () => {
    const [rollup] = rollupByDay([
      sample("2026-01-01T01:00:00Z", false, 5000),
      sample("2026-01-01T02:00:00Z", false, 5000),
    ]);
    expect(rollup!.p50Ms).toBeNull();
    expect(rollup!.minMs).toBeNull();
    expect(rollup!.maxMs).toBeNull();
    expect(rollup!.upCount).toBe(0);
  });

  it("ignores null latencies without dropping the sample", () => {
    const [rollup] = rollupByDay([
      sample("2026-01-01T01:00:00Z", true, null),
      sample("2026-01-01T02:00:00Z", true, 100),
    ]);
    expect(rollup!.upCount).toBe(2);
    expect(rollup!.minMs).toBe(100);
  });

  it("is deterministic, so the nightly job can be safely re-run", () => {
    const samples = [
      sample("2026-01-01T01:00:00Z", true, 150),
      sample("2026-01-01T02:00:00Z", false),
      sample("2026-01-01T03:00:00Z", true, 250),
    ];
    expect(rollupByDay(samples)).toEqual(rollupByDay(samples));
  });

  it("does not mutate its input", () => {
    const samples = [
      sample("2026-01-01T02:00:00Z", true, 200),
      sample("2026-01-01T01:00:00Z", true, 100),
    ];
    const snapshot = samples.map((s) => s.ts.toISOString());
    rollupByDay(samples);
    expect(samples.map((s) => s.ts.toISOString())).toEqual(snapshot);
  });
});

describe("rollupAvailability", () => {
  const day = new Date("2026-01-01T00:00:00Z");
  const rollup = (upCount: number, totalCount: number) => ({
    day,
    upCount,
    totalCount,
    p50Ms: null,
    p95Ms: null,
    p99Ms: null,
    minMs: null,
    maxMs: null,
  });

  it("reports 100% when every check passed", () => {
    expect(rollupAvailability(rollup(10, 10))).toBe(100);
  });

  it("reports 0% when every check failed", () => {
    expect(rollupAvailability(rollup(0, 10))).toBe(0);
  });

  it("reports the ratio in between", () => {
    expect(rollupAvailability(rollup(9, 10))).toBe(90);
  });

  it("reports 100% for a day with no checks rather than dividing by zero", () => {
    expect(rollupAvailability(rollup(0, 0))).toBe(100);
  });
});
