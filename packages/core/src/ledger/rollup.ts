/**
 * Daily aggregation of raw checks.
 *
 * Rollups are what every user-facing uptime number reads. Raw `Check` rows are
 * retained for 30 days and scanned only by the verdict machine.
 */

export interface CheckSample {
  ts: Date;
  ok: boolean;
  latencyMs: number | null;
}

export interface DailyRollup {
  /** UTC midnight of the day being summarised. */
  day: Date;
  upCount: number;
  totalCount: number;
  p50Ms: number | null;
  p95Ms: number | null;
  p99Ms: number | null;
  minMs: number | null;
  maxMs: number | null;
}

/**
 * Nearest-rank percentile.
 *
 * Chosen over linear interpolation because every reported value is then a
 * latency the service actually produced. An interpolated p95 of 431ms that no
 * request ever took is harder to reason about during an incident.
 *
 * `values` must be sorted ascending.
 */
export function percentile(sorted: readonly number[], p: number): number | null {
  if (sorted.length === 0) return null;
  if (p <= 0) return sorted[0]!;
  if (p >= 100) return sorted[sorted.length - 1]!;

  const rank = Math.ceil((p / 100) * sorted.length);
  const index = Math.min(sorted.length - 1, Math.max(0, rank - 1));
  return sorted[index]!;
}

/** UTC midnight of the day containing `ts`. */
export function utcDayStart(ts: Date): Date {
  return new Date(Date.UTC(ts.getUTCFullYear(), ts.getUTCMonth(), ts.getUTCDate()));
}

/**
 * Reduce raw samples into one rollup per UTC day.
 *
 * Deterministic and total: the same input always produces the same output and
 * nothing is read from the ambient clock, which is what makes the nightly job
 * safely re-runnable after a failure.
 *
 * Latency statistics are computed from successful checks only. A failed probe's
 * latency is the time spent failing, and mixing that into p95 makes an outage
 * look like a slowdown.
 */
export function rollupByDay(samples: readonly CheckSample[]): DailyRollup[] {
  const days = new Map<number, { up: number; total: number; latencies: number[] }>();

  for (const sample of samples) {
    const key = utcDayStart(sample.ts).getTime();
    let bucket = days.get(key);
    if (!bucket) {
      bucket = { up: 0, total: 0, latencies: [] };
      days.set(key, bucket);
    }
    bucket.total += 1;
    if (sample.ok) {
      bucket.up += 1;
      if (sample.latencyMs !== null) bucket.latencies.push(sample.latencyMs);
    }
  }

  return [...days.entries()]
    .sort(([a], [b]) => a - b)
    .map(([key, bucket]) => {
      const sorted = [...bucket.latencies].sort((a, b) => a - b);
      return {
        day: new Date(key),
        upCount: bucket.up,
        totalCount: bucket.total,
        p50Ms: percentile(sorted, 50),
        p95Ms: percentile(sorted, 95),
        p99Ms: percentile(sorted, 99),
        minMs: sorted.length > 0 ? sorted[0]! : null,
        maxMs: sorted.length > 0 ? sorted[sorted.length - 1]! : null,
      };
    });
}

/**
 * Availability ratio for a single day's rollup, as a percentage.
 *
 * This is a *check ratio*, suitable only for the per-day bars on a status page
 * where each day has a uniform interval. Contractual SLA must use
 * `computeUptime`, which is interval-independent. See ADR 0003.
 */
export function rollupAvailability(rollup: DailyRollup): number {
  if (rollup.totalCount === 0) return 100;
  return (rollup.upCount / rollup.totalCount) * 100;
}
