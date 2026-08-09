import { describe, expect, it } from "vitest";
import { aggregateUptime, buildChart, formatMs, ratioUptime } from "./chart";

const OPTIONS = { width: 100, height: 20, padding: 2 };

describe("buildChart", () => {
  it("returns null for an empty series so callers can show no-data", () => {
    expect(buildChart([], OPTIONS)).toBeNull();
  });

  it("draws a single sample as a flat line across the full width", () => {
    const chart = buildChart([42], OPTIONS);
    expect(chart?.line).toBe("M 0 10.00 L 100 10.00");
    expect(chart?.min).toBe(42);
    expect(chart?.max).toBe(42);
  });

  it("centres a flat series instead of pinning it to the top", () => {
    // A zero span must not divide by zero and collapse to y=0.
    const chart = buildChart([5, 5, 5], OPTIONS);
    expect(chart?.line).toBe("M 0.00 10.00 L 50.00 10.00 L 100.00 10.00");
  });

  it("puts the maximum at the top and the minimum at the bottom", () => {
    const chart = buildChart([0, 10], OPTIONS);
    // y grows downward in SVG, so the larger value gets the smaller y.
    expect(chart?.line).toBe("M 0.00 18.00 L 100.00 2.00");
  });

  it("respects padding so the stroke is not clipped", () => {
    const chart = buildChart([0, 100], { width: 100, height: 20, padding: 5 });
    expect(chart?.line).toContain("15.00");
    expect(chart?.line).toContain("5.00");
  });

  it("closes the area path along the baseline", () => {
    const chart = buildChart([1, 2], OPTIONS);
    expect(chart?.area.endsWith("Z")).toBe(true);
    expect(chart?.area).toContain(`L 100.00 ${OPTIONS.height}`);
  });

  it("uses an explicit domain so two series can share a scale", () => {
    // Alone, [5,5] would centre. Against a 0–10 domain it must sit mid-height;
    // against 0–20 it must sit lower, proving the domain drives the scale.
    const shared = { width: 100, height: 20, padding: 0 };
    const midOfTen = buildChart([5, 5], { ...shared, domain: { min: 0, max: 10 } });
    const lowOfTwenty = buildChart([5, 5], { ...shared, domain: { min: 0, max: 20 } });

    expect(midOfTen?.line).toContain("10.00");
    expect(lowOfTwenty?.line).toContain("15.00");
  });

  it("reports the domain it actually used", () => {
    const chart = buildChart([3, 4], { ...OPTIONS, domain: { min: 0, max: 100 } });
    expect(chart?.min).toBe(0);
    expect(chart?.max).toBe(100);
  });

  it("spaces samples evenly across the width", () => {
    const chart = buildChart([1, 2, 3, 4, 5], OPTIONS);
    expect(chart?.line).toContain("M 0.00");
    expect(chart?.line).toContain("L 25.00");
    expect(chart?.line).toContain("L 100.00");
  });
});

describe("formatMs", () => {
  it("keeps sub-second values in milliseconds", () => {
    expect(formatMs(87)).toBe("87ms");
    expect(formatMs(999)).toBe("999ms");
  });

  it("switches to seconds at a thousand", () => {
    expect(formatMs(1000)).toBe("1.0s");
    expect(formatMs(2450)).toBe("2.5s");
  });

  it("drops the decimal for large values", () => {
    expect(formatMs(12_000)).toBe("12s");
  });
});

describe("ratioUptime", () => {
  const day = (up: number, total = 100) => ({ upCount: up, totalCount: total });

  it("returns null when there is no data in the window", () => {
    expect(ratioUptime([], 7)).toBeNull();
    expect(ratioUptime([day(0, 0)], 7)).toBeNull();
  });

  it("reports 100 for a clean window", () => {
    expect(ratioUptime([day(100), day(100)], 7)).toBe(100);
  });

  it("only counts the trailing window", () => {
    // The bad day falls outside a 1-day window.
    expect(ratioUptime([day(0), day(100)], 1)).toBe(100);
  });

  it("weights by checks rather than by day", () => {
    // 150 of 200 checks passed, not the 75% a per-day mean would give.
    expect(ratioUptime([day(50, 100), day(100, 100)], 2)).toBe(75);
  });
});

describe("aggregateUptime", () => {
  const day = (up: number, total = 100) => ({ upCount: up, totalCount: total });

  it("returns null when no component has data", () => {
    expect(aggregateUptime([], 7)).toBeNull();
    expect(aggregateUptime([[], []], 7)).toBeNull();
  });

  it("pools checks across components rather than averaging percentages", () => {
    // 100/100 and 0/900: pooled is 10%, while a per-component mean would be 50%.
    expect(aggregateUptime([[day(100, 100)], [day(0, 900)]], 7)).toBe(10);
  });

  it("slices each component's own window before summing", () => {
    // The older bad day falls outside a 1-day window for both components.
    const a = [day(0), day(100)];
    const b = [day(0), day(100)];
    expect(aggregateUptime([a, b], 1)).toBe(100);
  });

  it("tolerates components with shorter histories", () => {
    expect(aggregateUptime([[day(100)], [day(50), day(100)]], 30)).toBe((250 / 300) * 100);
  });
});
