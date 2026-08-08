import { clampToWindow, durationMs, mergeIntervals, type Interval } from "../time.js";

/** An outage as recorded. `end` is null while the incident is still open. */
export interface IncidentPeriod {
  start: Date;
  /** Null means unresolved: the outage is still running. */
  end: Date | null;
  severity: "DEGRADED" | "DOWN";
}

export interface UptimeInput {
  window: Interval;
  incidents: readonly IncidentPeriod[];
  maintenance: readonly Interval[];
  /**
   * Whether DEGRADED periods count against availability. Most SLAs are written
   * against hard unavailability, so this defaults to false at the call site.
   */
  countDegraded: boolean;
}

export interface UptimeResult {
  windowMs: number;
  /** Window duration minus maintenance: the time actually being measured. */
  measuredMs: number;
  downtimeMs: number;
  uptimePercent: number;
  incidentCount: number;
}

/**
 * Compute availability over a window from incident durations.
 *
 * Deliberately not `passedChecks / totalChecks`. Each check implicitly
 * represents a span equal to the monitor's interval, so a ratio silently skews
 * the moment that interval changes, a monitor is paused, or a region is added.
 * Durations are immune to all three.
 *
 * Maintenance is subtracted from both the denominator and any overlapping
 * downtime, matching how SLAs are written contractually: planned work is
 * excluded from the measurement rather than counted as an outage.
 */
export function computeUptime(input: UptimeInput): UptimeResult {
  const { window, incidents, maintenance, countDegraded } = input;

  const windowMs = durationMs(window);
  if (windowMs === 0) {
    return { windowMs: 0, measuredMs: 0, downtimeMs: 0, uptimePercent: 100, incidentCount: 0 };
  }

  // Merge first: two incidents covering the same minute are one minute of
  // unavailability, not two. Without this, overlapping outages double-count and
  // uptime is reported as worse than reality.
  const maintenanceWindows = mergeIntervals(
    maintenance.map((m) => clampToWindow(m, window)).filter((m): m is Interval => m !== null),
  );
  const maintenanceMs = maintenanceWindows.reduce((sum, m) => sum + durationMs(m), 0);
  const measuredMs = Math.max(0, windowMs - maintenanceMs);

  const counted = incidents.filter((i) => countDegraded || i.severity === "DOWN");

  const clamped = counted
    .map((i) => clampToWindow({ start: i.start, end: i.end ?? window.end }, window))
    .filter((i): i is Interval => i !== null);

  const outages = mergeIntervals(clamped);
  const downtimeMs = outages.reduce(
    (sum, outage) => sum + durationMs(outage) - overlapWithAll(outage, maintenanceWindows),
    0,
  );

  const safeDowntime = Math.min(Math.max(0, downtimeMs), measuredMs);
  const uptimePercent = measuredMs === 0 ? 100 : ((measuredMs - safeDowntime) / measuredMs) * 100;

  return {
    windowMs,
    measuredMs,
    downtimeMs: safeDowntime,
    uptimePercent,
    incidentCount: outages.length,
  };
}

/** Total overlap between one interval and a set of disjoint intervals. */
function overlapWithAll(interval: Interval, others: readonly Interval[]): number {
  let total = 0;
  for (const other of others) {
    const start = Math.max(interval.start.getTime(), other.start.getTime());
    const end = Math.min(interval.end.getTime(), other.end.getTime());
    if (end > start) total += end - start;
  }
  return total;
}

/**
 * Round an availability percentage for display without ever rounding *up* to a
 * value the service did not achieve.
 *
 * 99.9994% must not render as "100%" on a status page — that is the difference
 * between a clean month and a breached SLA, and claiming perfection you did not
 * earn is the kind of error that costs credibility.
 */
export function formatUptime(percent: number, decimals = 3): string {
  const factor = 10 ** decimals;
  const floored = Math.floor(percent * factor) / factor;
  return `${floored.toFixed(decimals)}%`;
}
