import type { Observation } from "@uptick/core";
import type { PrismaClient } from "@uptick/db";
import type { IncidentAction, MonitorPolicy, OpenIncident } from "./evaluator.js";

/** Database access for incident evaluation. Kept apart from the pure logic. */

/**
 * How many recent checks per monitor to fold.
 *
 * Must exceed the largest confirmation threshold with room to spare, but stay
 * small: this query runs for every monitor on every tick, and `Check` is the
 * one unbounded table in the schema.
 */
export const OBSERVATION_WINDOW = 10;

export interface MonitorEvaluationState {
  policy: MonitorPolicy;
  observations: Observation[];
  openIncident: OpenIncident | null;
  recentTransitions: Date[];
  isFlapping: boolean;
  inMaintenance: boolean;
}

interface CheckRow {
  monitorId: string;
  regionSlug: string;
  ts: Date;
  ok: boolean;
  latencyMs: number | null;
  error: string | null;
}

/**
 * Load the recent observations for many monitors in one query.
 *
 * A lateral join keeps this to a single round trip. Looping per monitor would
 * turn one tick into N queries, and at 200 monitors the pooled connection
 * becomes the bottleneck long before the probes do.
 */
export async function loadObservations(
  prisma: PrismaClient,
  monitorIds: readonly string[],
): Promise<Map<string, Observation[]>> {
  if (monitorIds.length === 0) return new Map();

  const rows = await prisma.$queryRaw<CheckRow[]>`
    SELECT c."monitorId", r.slug AS "regionSlug", c.ts, c.ok, c."latencyMs", c.error
    FROM unnest(${monitorIds}::text[]) AS m(id)
    CROSS JOIN LATERAL (
      SELECT "monitorId", "regionId", ts, ok, "latencyMs", error
      FROM "Check"
      WHERE "monitorId" = m.id
      ORDER BY ts DESC
      LIMIT ${OBSERVATION_WINDOW * 3}
    ) AS c
    JOIN "Region" r ON r.id = c."regionId"
  `;

  const byMonitor = new Map<string, Observation[]>();
  for (const row of rows) {
    const list = byMonitor.get(row.monitorId) ?? [];
    list.push({
      regionSlug: row.regionSlug,
      ts: row.ts,
      ok: row.ok,
      latencyMs: row.latencyMs,
      error: row.error,
    });
    byMonitor.set(row.monitorId, list);
  }
  return byMonitor;
}

/** Currently open (unresolved) incidents for the given monitors. */
export async function loadOpenIncidents(
  prisma: PrismaClient,
  monitorIds: readonly string[],
): Promise<Map<string, OpenIncident>> {
  const rows = await prisma.incident.findMany({
    where: { monitorId: { in: [...monitorIds] }, resolvedAt: null },
    select: { id: true, monitorId: true, severity: true, startedAt: true, isFlapping: true },
    orderBy: { startedAt: "desc" },
  });

  const byMonitor = new Map<string, OpenIncident>();
  for (const row of rows) {
    // Keep the most recent only; duplicates would be a data error, and acting
    // on the older one would resolve the wrong record.
    if (!byMonitor.has(row.monitorId)) {
      byMonitor.set(row.monitorId, {
        id: row.id,
        severity: row.severity,
        startedAt: row.startedAt,
      });
    }
  }
  return byMonitor;
}

/** Monitor IDs currently covered by an active maintenance window. */
export async function loadMaintenanceCoverage(
  prisma: PrismaClient,
  now: Date,
): Promise<Set<string>> {
  const windows = await prisma.maintenanceWindow.findMany({
    where: { startsAt: { lte: now }, endsAt: { gte: now } },
    select: { monitorIds: true },
  });
  return new Set(windows.flatMap((w) => w.monitorIds));
}

/**
 * Recent state transitions per monitor, for flap detection.
 *
 * Derived from incident boundaries rather than stored separately: an incident
 * opening and resolving IS a pair of transitions, so there is no second source
 * of truth to keep in sync.
 */
export async function loadRecentTransitions(
  prisma: PrismaClient,
  monitorIds: readonly string[],
  since: Date,
): Promise<Map<string, Date[]>> {
  const rows = await prisma.incident.findMany({
    where: {
      monitorId: { in: [...monitorIds] },
      OR: [{ startedAt: { gte: since } }, { resolvedAt: { gte: since } }],
    },
    select: { monitorId: true, startedAt: true, resolvedAt: true },
  });

  const byMonitor = new Map<string, Date[]>();
  for (const row of rows) {
    const list = byMonitor.get(row.monitorId) ?? [];
    if (row.startedAt >= since) list.push(row.startedAt);
    if (row.resolvedAt && row.resolvedAt >= since) list.push(row.resolvedAt);
    byMonitor.set(row.monitorId, list);
  }
  return byMonitor;
}

/**
 * Persist one monitor's evaluation.
 *
 * The incident write and the monitor's state update happen in one transaction.
 * Split, a crash between them leaves the monitor claiming UP while an incident
 * is still open, and the next tick opens a second one — double-counting the
 * outage in every SLA figure afterwards.
 */
export async function applyEvaluation(
  prisma: PrismaClient,
  monitorId: string,
  action: IncidentAction,
  nextState: MonitorPolicy["state"],
  now: Date,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    switch (action.kind) {
      case "OPEN": {
        const incident = await tx.incident.create({
          data: {
            monitorId,
            severity: action.severity,
            startedAt: now,
            cause: action.cause,
            failingRegions: action.failingRegions,
          },
          select: { id: true },
        });
        await tx.incidentUpdate.create({
          data: {
            incidentId: incident.id,
            status: "INVESTIGATING",
            body: action.cause ?? "Automated detection: monitor is not responding as expected.",
          },
        });
        break;
      }

      case "RESOLVE":
        await tx.incident.update({
          where: { id: action.incidentId },
          data: { resolvedAt: now },
        });
        await tx.incidentUpdate.create({
          data: {
            incidentId: action.incidentId,
            status: "RESOLVED",
            body: "Automated detection: monitor has recovered.",
          },
        });
        break;

      case "CHANGE_SEVERITY":
        await tx.incident.update({
          where: { id: action.incidentId },
          data: { severity: action.severity },
        });
        break;

      case "NONE":
        break;
    }

    await tx.monitor.update({ where: { id: monitorId }, data: { state: nextState } });
  });
}
