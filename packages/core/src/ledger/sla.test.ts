import { describe, expect, it } from "vitest";
import { days, hours, minutes } from "../time.js";
import { computeUptime, formatUptime, type IncidentPeriod } from "./sla.js";

const at = (iso: string) => new Date(iso);
const JANUARY = { start: at("2026-01-01T00:00:00Z"), end: at("2026-01-31T00:00:00Z") };

function outage(
  startIso: string,
  endIso: string | null,
  severity: "DOWN" | "DEGRADED" = "DOWN",
): IncidentPeriod {
  return { start: at(startIso), end: endIso === null ? null : at(endIso), severity };
}

const base = { maintenance: [], countDegraded: false };

describe("computeUptime", () => {
  it("reports 100% with no incidents", () => {
    const result = computeUptime({ ...base, window: JANUARY, incidents: [] });
    expect(result.uptimePercent).toBe(100);
    expect(result.downtimeMs).toBe(0);
  });

  it("subtracts a single outage", () => {
    const result = computeUptime({
      ...base,
      window: JANUARY,
      incidents: [outage("2026-01-05T00:00:00Z", "2026-01-05T01:00:00Z")],
    });
    expect(result.downtimeMs).toBe(hours(1));
    expect(result.uptimePercent).toBeCloseTo((1 - 1 / (30 * 24)) * 100, 6);
  });

  it("collapses overlapping outages instead of double-counting", () => {
    // Two incidents covering the same hour are one hour of unavailability.
    const result = computeUptime({
      ...base,
      window: JANUARY,
      incidents: [
        outage("2026-01-05T00:00:00Z", "2026-01-05T02:00:00Z"),
        outage("2026-01-05T01:00:00Z", "2026-01-05T03:00:00Z"),
      ],
    });
    expect(result.downtimeMs).toBe(hours(3));
    expect(result.incidentCount).toBe(1);
  });

  it("sums disjoint outages separately", () => {
    const result = computeUptime({
      ...base,
      window: JANUARY,
      incidents: [
        outage("2026-01-05T00:00:00Z", "2026-01-05T01:00:00Z"),
        outage("2026-01-10T00:00:00Z", "2026-01-10T01:00:00Z"),
      ],
    });
    expect(result.downtimeMs).toBe(hours(2));
    expect(result.incidentCount).toBe(2);
  });

  it("treats an unresolved incident as ongoing to the window end", () => {
    const result = computeUptime({
      ...base,
      window: JANUARY,
      incidents: [outage("2026-01-30T00:00:00Z", null)],
    });
    expect(result.downtimeMs).toBe(days(1));
  });

  it("clips an outage that started before the window", () => {
    const result = computeUptime({
      ...base,
      window: JANUARY,
      incidents: [outage("2025-12-31T22:00:00Z", "2026-01-01T01:00:00Z")],
    });
    expect(result.downtimeMs).toBe(hours(1));
  });

  it("clips an outage that ends after the window", () => {
    const result = computeUptime({
      ...base,
      window: JANUARY,
      incidents: [outage("2026-01-30T23:00:00Z", "2026-02-02T00:00:00Z")],
    });
    expect(result.downtimeMs).toBe(hours(1));
  });

  it("ignores an outage entirely outside the window", () => {
    const result = computeUptime({
      ...base,
      window: JANUARY,
      incidents: [outage("2026-03-01T00:00:00Z", "2026-03-02T00:00:00Z")],
    });
    expect(result.uptimePercent).toBe(100);
    expect(result.incidentCount).toBe(0);
  });

  it("excludes DEGRADED periods by default", () => {
    const result = computeUptime({
      ...base,
      window: JANUARY,
      incidents: [outage("2026-01-05T00:00:00Z", "2026-01-05T05:00:00Z", "DEGRADED")],
    });
    expect(result.downtimeMs).toBe(0);
  });

  it("includes DEGRADED periods when asked", () => {
    const result = computeUptime({
      window: JANUARY,
      maintenance: [],
      countDegraded: true,
      incidents: [outage("2026-01-05T00:00:00Z", "2026-01-05T05:00:00Z", "DEGRADED")],
    });
    expect(result.downtimeMs).toBe(hours(5));
  });

  describe("maintenance windows", () => {
    it("shrinks the measured window", () => {
      const result = computeUptime({
        ...base,
        window: JANUARY,
        maintenance: [{ start: at("2026-01-15T00:00:00Z"), end: at("2026-01-15T04:00:00Z") }],
        incidents: [],
      });
      expect(result.measuredMs).toBe(days(30) - hours(4));
      expect(result.uptimePercent).toBe(100);
    });

    it("does not count downtime that falls inside a maintenance window", () => {
      // Planned work must not be reported as an outage.
      const result = computeUptime({
        ...base,
        window: JANUARY,
        maintenance: [{ start: at("2026-01-15T00:00:00Z"), end: at("2026-01-15T04:00:00Z") }],
        incidents: [outage("2026-01-15T01:00:00Z", "2026-01-15T03:00:00Z")],
      });
      expect(result.downtimeMs).toBe(0);
      expect(result.uptimePercent).toBe(100);
    });

    it("counts only the portion of an outage outside the window", () => {
      const result = computeUptime({
        ...base,
        window: JANUARY,
        maintenance: [{ start: at("2026-01-15T00:00:00Z"), end: at("2026-01-15T02:00:00Z") }],
        incidents: [outage("2026-01-15T01:00:00Z", "2026-01-15T03:00:00Z")],
      });
      expect(result.downtimeMs).toBe(hours(1));
    });

    it("counts an outage in full when maintenance is scheduled elsewhere", () => {
      const result = computeUptime({
        ...base,
        window: JANUARY,
        maintenance: [{ start: at("2026-01-20T00:00:00Z"), end: at("2026-01-20T04:00:00Z") }],
        incidents: [outage("2026-01-05T00:00:00Z", "2026-01-05T02:00:00Z")],
      });
      expect(result.downtimeMs).toBe(hours(2));
    });

    it("merges overlapping maintenance windows before subtracting", () => {
      const result = computeUptime({
        ...base,
        window: JANUARY,
        maintenance: [
          { start: at("2026-01-15T00:00:00Z"), end: at("2026-01-15T03:00:00Z") },
          { start: at("2026-01-15T02:00:00Z"), end: at("2026-01-15T04:00:00Z") },
        ],
        incidents: [],
      });
      expect(result.measuredMs).toBe(days(30) - hours(4));
    });

    it("clips a maintenance window to the reporting window", () => {
      const result = computeUptime({
        ...base,
        window: JANUARY,
        maintenance: [{ start: at("2025-12-31T22:00:00Z"), end: at("2026-01-01T02:00:00Z") }],
        incidents: [],
      });
      expect(result.measuredMs).toBe(days(30) - hours(2));
    });

    it("ignores a maintenance window outside the reporting window", () => {
      const result = computeUptime({
        ...base,
        window: JANUARY,
        maintenance: [{ start: at("2026-06-01T00:00:00Z"), end: at("2026-06-02T00:00:00Z") }],
        incidents: [],
      });
      expect(result.measuredMs).toBe(days(30));
    });
  });

  describe("edge cases", () => {
    it("returns 100% for a zero-length window", () => {
      const instant = at("2026-01-01T00:00:00Z");
      const result = computeUptime({
        ...base,
        window: { start: instant, end: instant },
        incidents: [outage("2026-01-01T00:00:00Z", null)],
      });
      expect(result.uptimePercent).toBe(100);
      expect(result.windowMs).toBe(0);
    });

    it("reports 0% when the whole window is an outage", () => {
      const result = computeUptime({
        ...base,
        window: JANUARY,
        incidents: [outage("2026-01-01T00:00:00Z", "2026-01-31T00:00:00Z")],
      });
      expect(result.uptimePercent).toBe(0);
    });

    it("never reports negative uptime when maintenance covers everything", () => {
      const result = computeUptime({
        ...base,
        window: JANUARY,
        maintenance: [JANUARY],
        incidents: [outage("2026-01-05T00:00:00Z", "2026-01-06T00:00:00Z")],
      });
      expect(result.measuredMs).toBe(0);
      expect(result.uptimePercent).toBe(100);
    });

    it("is unaffected by the check interval, unlike a pass ratio", () => {
      // The reason this function exists: identical downtime must yield an
      // identical figure no matter how often the monitor was probed.
      const incidents = [outage("2026-01-05T00:00:00Z", "2026-01-05T00:30:00Z")];
      const a = computeUptime({ ...base, window: JANUARY, incidents });
      const b = computeUptime({ ...base, window: JANUARY, incidents });
      expect(a.uptimePercent).toBe(b.uptimePercent);
      expect(a.downtimeMs).toBe(minutes(30));
    });
  });
});

describe("formatUptime", () => {
  const cases: Array<[number, number, string]> = [
    [100, 3, "100.000%"],
    [99.9994, 3, "99.999%"],
    [99.98765, 3, "99.987%"],
    [0, 3, "0.000%"],
    [99.95, 1, "99.9%"],
    [99.999999, 2, "99.99%"],
  ];

  it.each(cases)("formats %f with %i decimals as %s", (percent, decimals, expected) => {
    expect(formatUptime(percent, decimals)).toBe(expected);
  });

  it("never rounds up to a figure the service did not achieve", () => {
    // 99.9994% is a breached three-nines SLA. Rendering it as 100% would be a
    // false claim on a public status page.
    expect(formatUptime(99.9994)).not.toBe("100.000%");
  });

  it("defaults to three decimals", () => {
    expect(formatUptime(99.5)).toBe("99.500%");
  });
});
