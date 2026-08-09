import { burnRate, computeErrorBudget, computeUptime, type IncidentPeriod } from "@uptick/core";
import { prisma, type MonitorState } from "@uptick/db";

/** Default reporting window for dashboard uptime figures. */
export const UPTIME_WINDOW_DAYS = 30;

export interface MonitorSummary {
  id: string;
  name: string;
  target: string;
  type: string;
  state: MonitorState;
  active: boolean;
  lastCheckAt: Date | null;
  uptimePercent: number;
  openIncidentId: string | null;
  p95Ms: number | null;
  /** Trailing p95 series for the row sparkline, oldest first. */
  latency: number[];
}

function windowStart(days: number, now: Date): Date {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

/**
 * Monitors for one org, with uptime over the reporting window.
 *
 * Every query here is filtered by `organizationId`, which the caller must have
 * obtained from `requireOrg` — never from the request. Uptime comes from
 * incident durations rather than check ratios (see computeUptime), and the p95
 * comes from CheckRollup: raw `checks` is never read on a user-facing path.
 */
export async function listMonitors(
  organizationId: string,
  now: Date = new Date(),
): Promise<MonitorSummary[]> {
  const since = windowStart(UPTIME_WINDOW_DAYS, now);

  const monitors = await prisma.monitor.findMany({
    where: { organizationId },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      target: true,
      type: true,
      state: true,
      active: true,
      lastCheckAt: true,
      incidents: {
        where: { OR: [{ resolvedAt: null }, { startedAt: { gte: since } }] },
        select: { id: true, startedAt: true, resolvedAt: true, severity: true },
      },
      rollups: {
        where: { day: { gte: since } },
        orderBy: { day: "asc" },
        select: { p95Ms: true },
      },
    },
  });

  const maintenance = await activeMaintenance(organizationId, since, now);

  return monitors.map((m) => {
    const periods: IncidentPeriod[] = m.incidents.map((i) => ({
      start: i.startedAt,
      end: i.resolvedAt,
      severity: i.severity,
    }));

    const uptime = computeUptime({
      window: { start: since, end: now },
      incidents: periods,
      maintenance,
      countDegraded: false,
    });

    const open = m.incidents.find((i) => i.resolvedAt === null);

    return {
      id: m.id,
      name: m.name,
      target: m.target,
      type: m.type,
      state: m.state,
      active: m.active,
      lastCheckAt: m.lastCheckAt,
      uptimePercent: uptime.uptimePercent,
      openIncidentId: open?.id ?? null,
      p95Ms: m.rollups.at(-1)?.p95Ms ?? null,
      latency: m.rollups.map((r) => r.p95Ms).filter((v): v is number => v !== null),
    };
  });
}

/** Maintenance windows overlapping the reporting window, for SLA exclusion. */
async function activeMaintenance(organizationId: string, since: Date, now: Date) {
  const windows = await prisma.maintenanceWindow.findMany({
    where: { organizationId, startsAt: { lte: now }, endsAt: { gte: since } },
    select: { startsAt: true, endsAt: true },
  });
  return windows.map((w) => ({ start: w.startsAt, end: w.endsAt }));
}

/**
 * One monitor, scoped by org.
 *
 * The org filter is part of the lookup rather than a check after the fact, so
 * a valid id belonging to another tenant returns null instead of that tenant's
 * configuration.
 */
export async function getMonitor(organizationId: string, monitorId: string) {
  return prisma.monitor.findFirst({
    where: { id: monitorId, organizationId },
    select: {
      id: true,
      name: true,
      target: true,
      type: true,
      method: true,
      state: true,
      active: true,
      intervalSec: true,
      timeoutMs: true,
      degradedMs: true,
      confirmThreshold: true,
      recoverThreshold: true,
      quorum: true,
      lastCheckAt: true,
      nextCheckAt: true,
    },
  });
}

/** Daily rollups for a monitor's uptime chart. Never scans raw checks. */
export async function getMonitorRollups(
  organizationId: string,
  monitorId: string,
  now: Date = new Date(),
) {
  const since = windowStart(UPTIME_WINDOW_DAYS, now);
  return prisma.checkRollup.findMany({
    where: { monitorId, monitor: { organizationId }, day: { gte: since } },
    orderBy: { day: "asc" },
    select: { day: true, upCount: true, totalCount: true, p50Ms: true, p95Ms: true },
  });
}

export interface MonitorBudget {
  objective: number;
  windowDays: number;
  allowedMs: number;
  consumedMs: number;
  remainingMs: number;
  consumedFraction: number;
  exhausted: boolean;
  burnRate: number;
}

/**
 * Error budget for a monitor's SLO target, or null if none is configured.
 *
 * The window is anchored to the target's own windowDays rather than the
 * dashboard's 30-day default, since an SLO written against 7 days means
 * something different from one written against 90.
 */
export async function getMonitorBudget(
  organizationId: string,
  monitorId: string,
  now: Date = new Date(),
): Promise<MonitorBudget | null> {
  const target = await prisma.sloTarget.findFirst({
    where: { monitorId, monitor: { organizationId } },
    orderBy: { windowDays: "asc" },
    select: { objective: true, windowDays: true },
  });

  if (!target) return null;

  const since = windowStart(target.windowDays, now);

  const [incidents, maintenance] = await Promise.all([
    prisma.incident.findMany({
      where: {
        monitorId,
        monitor: { organizationId },
        OR: [{ resolvedAt: null }, { startedAt: { gte: since } }],
      },
      select: { startedAt: true, resolvedAt: true, severity: true },
    }),
    prisma.maintenanceWindow.findMany({
      where: { organizationId, startsAt: { lte: now }, endsAt: { gte: since } },
      select: { startsAt: true, endsAt: true },
    }),
  ]);

  const budget = computeErrorBudget({
    window: { start: since, end: now },
    objective: Number(target.objective),
    incidents: incidents.map((i) => ({
      start: i.startedAt,
      end: i.resolvedAt,
      severity: i.severity,
    })),
    maintenance: maintenance.map((m) => ({ start: m.startsAt, end: m.endsAt })),
    countDegraded: false,
  });

  return {
    objective: Number(target.objective),
    windowDays: target.windowDays,
    allowedMs: budget.allowedMs,
    consumedMs: budget.consumedMs,
    remainingMs: budget.remainingMs,
    consumedFraction: budget.consumedFraction,
    exhausted: budget.exhausted,
    // The window always runs to now, so the elapsed fraction is 1 and burn
    // rate reduces to the consumed fraction. Kept explicit so a trailing
    // sub-window can be introduced without changing the call site.
    burnRate: burnRate(budget, 1),
  };
}

/** Incident feed for an org, newest first. */
export async function listIncidents(organizationId: string, limit = 50) {
  return prisma.incident.findMany({
    where: { monitor: { organizationId } },
    orderBy: { startedAt: "desc" },
    take: limit,
    select: {
      id: true,
      severity: true,
      startedAt: true,
      resolvedAt: true,
      cause: true,
      ackedAt: true,
      isFlapping: true,
      failingRegions: true,
      monitor: { select: { id: true, name: true } },
      ackedBy: { select: { name: true, email: true } },
    },
  });
}
