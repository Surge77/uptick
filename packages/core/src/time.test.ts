import { describe, expect, it } from "vitest";
import {
  clampToWindow,
  days,
  durationMs,
  fixedClock,
  formatDuration,
  hours,
  mergeIntervals,
  minutes,
  overlapMs,
  seconds,
  systemClock,
} from "./time.js";

const at = (iso: string) => new Date(iso);
const span = (startIso: string, endIso: string) => ({ start: at(startIso), end: at(endIso) });

describe("duration helpers", () => {
  it("converts units to milliseconds", () => {
    expect(seconds(1)).toBe(1_000);
    expect(minutes(1)).toBe(60_000);
    expect(hours(1)).toBe(3_600_000);
    expect(days(1)).toBe(86_400_000);
  });
});

describe("systemClock", () => {
  it("returns the current time", () => {
    const before = Date.now();
    const now = systemClock.now().getTime();
    expect(now).toBeGreaterThanOrEqual(before);
  });
});

describe("fixedClock", () => {
  it("stays frozen until advanced", () => {
    const clock = fixedClock("2026-01-01T00:00:00Z");
    expect(clock.now().toISOString()).toBe("2026-01-01T00:00:00.000Z");
    expect(clock.now().toISOString()).toBe("2026-01-01T00:00:00.000Z");
  });

  it("advances by the given offset", () => {
    const clock = fixedClock("2026-01-01T00:00:00Z");
    clock.advance(minutes(90));
    expect(clock.now().toISOString()).toBe("2026-01-01T01:30:00.000Z");
  });

  it("jumps to an absolute instant", () => {
    const clock = fixedClock("2026-01-01T00:00:00Z");
    clock.set("2026-03-04T05:06:07Z");
    expect(clock.now().toISOString()).toBe("2026-03-04T05:06:07.000Z");
  });
});

describe("durationMs", () => {
  it("measures a forward interval", () => {
    expect(durationMs(span("2026-01-01T00:00:00Z", "2026-01-01T00:05:00Z"))).toBe(minutes(5));
  });

  it("returns zero for a zero-length interval", () => {
    expect(durationMs(span("2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z"))).toBe(0);
  });

  it("returns zero rather than a negative for an inverted interval", () => {
    // Clock skew between regions can produce end < start; downtime must never
    // be credited back as negative time.
    expect(durationMs(span("2026-01-01T01:00:00Z", "2026-01-01T00:00:00Z"))).toBe(0);
  });
});

describe("overlapMs", () => {
  const cases: Array<[string, ReturnType<typeof span>, ReturnType<typeof span>, number]> = [
    [
      "identical intervals overlap fully",
      span("2026-01-01T00:00:00Z", "2026-01-01T01:00:00Z"),
      span("2026-01-01T00:00:00Z", "2026-01-01T01:00:00Z"),
      hours(1),
    ],
    [
      "partial overlap counts only the shared span",
      span("2026-01-01T00:00:00Z", "2026-01-01T01:00:00Z"),
      span("2026-01-01T00:30:00Z", "2026-01-01T02:00:00Z"),
      minutes(30),
    ],
    [
      "contained interval overlaps by its own length",
      span("2026-01-01T00:00:00Z", "2026-01-01T04:00:00Z"),
      span("2026-01-01T01:00:00Z", "2026-01-01T02:00:00Z"),
      hours(1),
    ],
    [
      "disjoint intervals do not overlap",
      span("2026-01-01T00:00:00Z", "2026-01-01T01:00:00Z"),
      span("2026-01-01T02:00:00Z", "2026-01-01T03:00:00Z"),
      0,
    ],
    [
      "touching intervals do not overlap (half-open)",
      span("2026-01-01T00:00:00Z", "2026-01-01T01:00:00Z"),
      span("2026-01-01T01:00:00Z", "2026-01-01T02:00:00Z"),
      0,
    ],
  ];

  it.each(cases)("%s", (_name, a, b, expected) => {
    expect(overlapMs(a, b)).toBe(expected);
    expect(overlapMs(b, a)).toBe(expected);
  });
});

describe("mergeIntervals", () => {
  it("returns an empty set for no input", () => {
    expect(mergeIntervals([])).toEqual([]);
  });

  it("drops zero-length intervals", () => {
    expect(mergeIntervals([span("2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z")])).toEqual([]);
  });

  it("leaves disjoint intervals untouched but sorted", () => {
    const merged = mergeIntervals([
      span("2026-01-01T05:00:00Z", "2026-01-01T06:00:00Z"),
      span("2026-01-01T01:00:00Z", "2026-01-01T02:00:00Z"),
    ]);
    expect(merged).toHaveLength(2);
    expect(merged[0]!.start.toISOString()).toBe("2026-01-01T01:00:00.000Z");
    expect(merged[1]!.start.toISOString()).toBe("2026-01-01T05:00:00.000Z");
  });

  it("collapses overlapping intervals so downtime is not double-counted", () => {
    const merged = mergeIntervals([
      span("2026-01-01T00:00:00Z", "2026-01-01T01:00:00Z"),
      span("2026-01-01T00:30:00Z", "2026-01-01T02:00:00Z"),
    ]);
    expect(merged).toHaveLength(1);
    expect(durationMs(merged[0]!)).toBe(hours(2));
  });

  it("collapses touching intervals into one", () => {
    const merged = mergeIntervals([
      span("2026-01-01T00:00:00Z", "2026-01-01T01:00:00Z"),
      span("2026-01-01T01:00:00Z", "2026-01-01T02:00:00Z"),
    ]);
    expect(merged).toHaveLength(1);
    expect(durationMs(merged[0]!)).toBe(hours(2));
  });

  it("absorbs a fully contained interval without shrinking the outer one", () => {
    const merged = mergeIntervals([
      span("2026-01-01T00:00:00Z", "2026-01-01T04:00:00Z"),
      span("2026-01-01T01:00:00Z", "2026-01-01T02:00:00Z"),
    ]);
    expect(merged).toHaveLength(1);
    expect(durationMs(merged[0]!)).toBe(hours(4));
  });

  it("merges a chain of successively overlapping intervals", () => {
    const merged = mergeIntervals([
      span("2026-01-01T00:00:00Z", "2026-01-01T01:00:00Z"),
      span("2026-01-01T00:45:00Z", "2026-01-01T02:00:00Z"),
      span("2026-01-01T01:50:00Z", "2026-01-01T03:00:00Z"),
    ]);
    expect(merged).toHaveLength(1);
    expect(durationMs(merged[0]!)).toBe(hours(3));
  });

  it("does not mutate its input", () => {
    const input = [
      span("2026-01-01T05:00:00Z", "2026-01-01T06:00:00Z"),
      span("2026-01-01T01:00:00Z", "2026-01-01T02:00:00Z"),
    ];
    mergeIntervals(input);
    expect(input[0]!.start.toISOString()).toBe("2026-01-01T05:00:00.000Z");
  });
});

describe("clampToWindow", () => {
  const window = span("2026-01-01T00:00:00Z", "2026-01-31T00:00:00Z");

  it("returns the interval unchanged when fully inside", () => {
    const clamped = clampToWindow(span("2026-01-10T00:00:00Z", "2026-01-11T00:00:00Z"), window);
    expect(durationMs(clamped!)).toBe(days(1));
  });

  it("trims an interval that starts before the window", () => {
    const clamped = clampToWindow(span("2025-12-25T00:00:00Z", "2026-01-02T00:00:00Z"), window);
    expect(clamped!.start.toISOString()).toBe("2026-01-01T00:00:00.000Z");
    expect(durationMs(clamped!)).toBe(days(1));
  });

  it("trims an interval that ends after the window", () => {
    const clamped = clampToWindow(span("2026-01-30T00:00:00Z", "2026-02-05T00:00:00Z"), window);
    expect(clamped!.end.toISOString()).toBe("2026-01-31T00:00:00.000Z");
    expect(durationMs(clamped!)).toBe(days(1));
  });

  it("returns null for an interval entirely outside the window", () => {
    expect(clampToWindow(span("2026-03-01T00:00:00Z", "2026-03-02T00:00:00Z"), window)).toBeNull();
  });

  it("returns null when the interval only touches the window edge", () => {
    expect(clampToWindow(span("2026-01-31T00:00:00Z", "2026-02-01T00:00:00Z"), window)).toBeNull();
  });
});

describe("formatDuration", () => {
  const cases: Array<[number, string]> = [
    [0, "0s"],
    [500, "0s"],
    [seconds(43), "43s"],
    [minutes(5), "5m"],
    [minutes(5) + seconds(30), "5m 30s"],
    [hours(2) + minutes(5), "2h 5m"],
    [hours(2), "2h"],
    [days(1) + hours(3), "1d 3h"],
    [days(2) + minutes(1), "2d 1m"],
  ];

  it.each(cases)("formats %ims as %s", (ms, expected) => {
    expect(formatDuration(ms)).toBe(expected);
  });

  it("omits seconds once the duration reaches an hour", () => {
    expect(formatDuration(hours(1) + seconds(59))).toBe("1h");
  });
});
