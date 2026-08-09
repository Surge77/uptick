import { Prisma, type PrismaClient } from "@uptick/db";
import type { CheckRecord, LeasedMonitor } from "./scheduler.js";

/**
 * Monitor leasing.
 *
 * Prisma cannot express `FOR UPDATE SKIP LOCKED`, so this is raw SQL. The
 * guarantee it provides is the reason the worker can be deployed more than
 * once per region and restarted mid-tick without ever double-probing.
 */

interface LeaseRow {
  id: string;
  name: string;
  type: LeasedMonitor["type"];
  target: string;
  intervalSec: number;
  timeoutMs: number;
}

/**
 * Claim up to `limit` due monitors and advance their `nextCheckAt`.
 *
 * Three properties matter, and all three come from doing this as ONE statement:
 *
 *  1. `FOR UPDATE SKIP LOCKED` — a second worker takes the next unlocked rows
 *     instead of blocking on, or duplicating, rows already claimed.
 *  2. The `UPDATE ... FROM (SELECT ...)` form means the claim and the
 *     `nextCheckAt` advance commit together. Split into two statements, a crash
 *     between them re-runs the batch, and a concurrent worker sees rows that
 *     look due but are already in flight.
 *  3. `nextCheckAt` is pushed out by the monitor's own interval, so the lease
 *     releases itself. A crashed worker needs no reaper: its transaction rolls
 *     back and the rows are immediately due again.
 *
 * Advancing by `intervalSec` up front means a probe slower than its interval
 * does not queue a backlog — the next claim simply happens on the following
 * tick.
 */
export async function leaseDueMonitors(
  prisma: PrismaClient,
  limit: number,
  now: Date,
): Promise<LeasedMonitor[]> {
  const rows = await prisma.$queryRaw<LeaseRow[]>(Prisma.sql`
    UPDATE "Monitor" AS m
    SET "nextCheckAt" = ${now} + make_interval(secs => m."intervalSec"),
        "lastCheckAt" = ${now}
    FROM (
      SELECT id
      FROM "Monitor"
      WHERE "active" = true
        AND "nextCheckAt" <= ${now}
      ORDER BY "nextCheckAt" ASC
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    ) AS due
    WHERE m.id = due.id
    RETURNING m.id, m.name, m.type, m.target, m."intervalSec", m."timeoutMs"
  `);

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    type: row.type,
    target: row.target,
    intervalSec: Number(row.intervalSec),
    timeoutMs: Number(row.timeoutMs),
  }));
}

/**
 * Write a tick's checks in one statement.
 *
 * `createMany` rather than a loop: at 200 monitors a tick, per-row inserts turn
 * one round trip into two hundred, and the pooled connection becomes the
 * bottleneck long before the probes do.
 */
export async function recordChecks(
  prisma: PrismaClient,
  regionId: string,
  records: readonly CheckRecord[],
): Promise<void> {
  if (records.length === 0) return;

  await prisma.check.createMany({
    data: records.map((record) => ({
      monitorId: record.monitorId,
      regionId,
      ok: record.result.ok,
      statusCode: record.result.statusCode,
      latencyMs: record.result.latencyMs,
      error: record.result.error,
      dnsMs: record.result.dnsMs,
      connectMs: record.result.connectMs,
      tlsMs: record.result.tlsMs,
      ttfbMs: record.result.ttfbMs,
    })),
  });
}

/** Create the monthly partition covering `at`. Idempotent by construction. */
export async function ensureCheckPartition(prisma: PrismaClient, at: Date): Promise<void> {
  await prisma.$queryRaw`SELECT uptick_ensure_check_partition(${at}::timestamp(3))`;
}

/** Resolve this worker's region row, failing loudly if it is not registered. */
export async function resolveRegionId(prisma: PrismaClient, slug: string): Promise<string> {
  const region = await prisma.region.findUnique({ where: { slug }, select: { id: true } });
  if (!region) {
    // Writing checks under an invented region would silently corrupt quorum,
    // so refuse to start instead.
    throw new Error(
      `Region "${slug}" is not registered. Insert a Region row before starting this worker.`,
    );
  }
  return region.id;
}
