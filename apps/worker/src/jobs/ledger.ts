import { rollupByDay, utcDayStart, type CheckSample } from "@uptick/core";
import type { PrismaClient } from "@uptick/db";

/**
 * Nightly aggregation and retention.
 *
 * Both operations are idempotent so a failed run is fixed by re-running it,
 * which is the whole reason they are a scheduled job rather than incremental
 * bookkeeping on the write path.
 */

export const DEFAULT_RETAIN_DAYS = 30;

export interface RollupSummary {
  day: Date;
  monitorsProcessed: number;
  rowsWritten: number;
}

/**
 * Rebuild `CheckRollup` for one UTC day.
 *
 * Recomputes from raw checks rather than accumulating, so a re-run overwrites
 * instead of double-counting. `downtimeSec` comes from incident durations
 * clipped to the day, not from the check ratio — see ADR 0003.
 */
export async function rollupDay(
  prisma: PrismaClient,
  day: Date,
  now: Date = new Date(),
): Promise<RollupSummary> {
  const start = utcDayStart(day);
  const end = new Date(start.getTime() + 86_400_000);

  const checks = await prisma.check.findMany({
    where: { ts: { gte: start, lt: end } },
    select: { monitorId: true, ts: true, ok: true, latencyMs: true },
  });

  const byMonitor = new Map<string, CheckSample[]>();
  for (const check of checks) {
    const list = byMonitor.get(check.monitorId) ?? [];
    list.push({ ts: check.ts, ok: check.ok, latencyMs: check.latencyMs });
    byMonitor.set(check.monitorId, list);
  }

  const downtime = await downtimeSecondsByMonitor(prisma, start, end, now);

  let rowsWritten = 0;
  for (const [monitorId, samples] of byMonitor) {
    const [rollup] = rollupByDay(samples);
    if (!rollup) continue;

    await prisma.checkRollup.upsert({
      where: { monitorId_day: { monitorId, day: start } },
      update: {
        upCount: rollup.upCount,
        totalCount: rollup.totalCount,
        p50Ms: rollup.p50Ms,
        p95Ms: rollup.p95Ms,
        p99Ms: rollup.p99Ms,
        minMs: rollup.minMs,
        maxMs: rollup.maxMs,
        downtimeSec: downtime.get(monitorId) ?? 0,
      },
      create: {
        monitorId,
        day: start,
        upCount: rollup.upCount,
        totalCount: rollup.totalCount,
        p50Ms: rollup.p50Ms,
        p95Ms: rollup.p95Ms,
        p99Ms: rollup.p99Ms,
        minMs: rollup.minMs,
        maxMs: rollup.maxMs,
        downtimeSec: downtime.get(monitorId) ?? 0,
      },
    });
    rowsWritten += 1;
  }

  return { day: start, monitorsProcessed: byMonitor.size, rowsWritten };
}

/**
 * Seconds of confirmed DOWN time per monitor within a day.
 *
 * An incident still open at the end of the window is counted up to the window
 * edge, not to `now`: a day's figure must not keep changing after the day ends.
 */
export async function downtimeSecondsByMonitor(
  prisma: PrismaClient,
  start: Date,
  end: Date,
  now: Date,
): Promise<Map<string, number>> {
  const incidents = await prisma.incident.findMany({
    where: {
      severity: "DOWN",
      startedAt: { lt: end },
      OR: [{ resolvedAt: null }, { resolvedAt: { gt: start } }],
    },
    select: { monitorId: true, startedAt: true, resolvedAt: true },
  });

  const ceiling = Math.min(end.getTime(), now.getTime());
  const totals = new Map<string, number>();

  for (const incident of incidents) {
    const from = Math.max(incident.startedAt.getTime(), start.getTime());
    const to = Math.min(incident.resolvedAt?.getTime() ?? ceiling, end.getTime());
    if (to <= from) continue;

    const seconds = Math.round((to - from) / 1000);
    totals.set(incident.monitorId, (totals.get(incident.monitorId) ?? 0) + seconds);
  }

  return totals;
}

/**
 * Drop `Check` partitions entirely older than the retention window.
 *
 * A partition DROP rather than a DELETE: removing tens of millions of rows
 * leaves dead tuples that bloat the heap and force an expensive vacuum, while
 * dropping the partition is effectively instantaneous.
 */
export async function pruneChecks(
  prisma: PrismaClient,
  retainDays: number = DEFAULT_RETAIN_DAYS,
): Promise<string[]> {
  const dropped = await prisma.$queryRaw<Array<{ uptick_prune_check_partitions: string }>>`
    SELECT * FROM uptick_prune_check_partitions(${retainDays})
  `;
  return dropped.map((row) => row.uptick_prune_check_partitions);
}

/** Days that should be rolled up: yesterday, plus today so far. */
export function daysToRollup(now: Date): Date[] {
  const today = utcDayStart(now);
  const yesterday = new Date(today.getTime() - 86_400_000);
  return [yesterday, today];
}
