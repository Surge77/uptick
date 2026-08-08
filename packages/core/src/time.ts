/**
 * Time utilities for `@uptick/core`.
 *
 * Nothing in this package reads the ambient clock. A `Clock` is passed in
 * wherever "now" is needed, which is what makes the verdict machine, quorum
 * resolver, and SLA math deterministically testable.
 */

/** Injected source of the current time. Production passes `systemClock`. */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = {
  now: () => new Date(),
};

/** A clock frozen at, or advanced manually from, a fixed instant. For tests. */
export function fixedClock(start: Date | string | number): Clock & {
  advance(ms: number): void;
  set(to: Date | string | number): void;
} {
  let current = new Date(start).getTime();
  return {
    now: () => new Date(current),
    advance: (ms: number) => {
      current += ms;
    },
    set: (to: Date | string | number) => {
      current = new Date(to).getTime();
    },
  };
}

export const MS_PER_SECOND = 1_000;
export const MS_PER_MINUTE = 60 * MS_PER_SECOND;
export const MS_PER_HOUR = 60 * MS_PER_MINUTE;
export const MS_PER_DAY = 24 * MS_PER_HOUR;

export const seconds = (n: number): number => n * MS_PER_SECOND;
export const minutes = (n: number): number => n * MS_PER_MINUTE;
export const hours = (n: number): number => n * MS_PER_HOUR;
export const days = (n: number): number => n * MS_PER_DAY;

/** A half-open interval `[start, end)`. */
export interface Interval {
  start: Date;
  end: Date;
}

/** Duration of an interval in milliseconds. Never negative. */
export function durationMs(interval: Interval): number {
  return Math.max(0, interval.end.getTime() - interval.start.getTime());
}

/**
 * Overlap between two half-open intervals, in milliseconds.
 *
 * Used to subtract maintenance windows from outage durations, so planned
 * downtime is excluded from SLA rather than counted against it.
 */
export function overlapMs(a: Interval, b: Interval): number {
  const start = Math.max(a.start.getTime(), b.start.getTime());
  const end = Math.min(a.end.getTime(), b.end.getTime());
  return Math.max(0, end - start);
}

/**
 * Merge overlapping or touching intervals into a minimal disjoint set,
 * sorted by start.
 *
 * Overlapping outages must not be double-counted when summing downtime — two
 * incidents covering the same wall-clock minute represent one minute of
 * unavailability, not two.
 */
export function mergeIntervals(intervals: readonly Interval[]): Interval[] {
  if (intervals.length === 0) return [];

  const sorted = [...intervals]
    .filter((i) => durationMs(i) > 0)
    .sort((a, b) => a.start.getTime() - b.start.getTime());

  if (sorted.length === 0) return [];

  const merged: Interval[] = [];
  let current = { start: sorted[0]!.start, end: sorted[0]!.end };

  for (const next of sorted.slice(1)) {
    if (next.start.getTime() <= current.end.getTime()) {
      if (next.end.getTime() > current.end.getTime()) current = { ...current, end: next.end };
    } else {
      merged.push(current);
      current = { start: next.start, end: next.end };
    }
  }
  merged.push(current);
  return merged;
}

/** Clamp an interval to the bounds of a window, or null if they do not overlap. */
export function clampToWindow(interval: Interval, window: Interval): Interval | null {
  const start = Math.max(interval.start.getTime(), window.start.getTime());
  const end = Math.min(interval.end.getTime(), window.end.getTime());
  if (end <= start) return null;
  return { start: new Date(start), end: new Date(end) };
}

/** Format a millisecond duration compactly, e.g. `2h 5m`, `43s`, `0s`. */
export function formatDuration(ms: number): string {
  if (ms < MS_PER_SECOND) return "0s";

  const d = Math.floor(ms / MS_PER_DAY);
  const h = Math.floor((ms % MS_PER_DAY) / MS_PER_HOUR);
  const m = Math.floor((ms % MS_PER_HOUR) / MS_PER_MINUTE);
  const s = Math.floor((ms % MS_PER_MINUTE) / MS_PER_SECOND);

  const parts: string[] = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0) parts.push(`${h}h`);
  if (m > 0) parts.push(`${m}m`);
  if (s > 0 && d === 0 && h === 0) parts.push(`${s}s`);

  return parts.join(" ");
}
