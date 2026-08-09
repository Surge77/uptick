import { computeUptime, type IncidentPeriod } from "@uptick/core";
import { prisma, type MonitorState } from "@uptick/db";
import { worstState } from "./status-severity";

/** Public pages show a 90-day history strip, the usual convention. */
export const STATUS_WINDOW_DAYS = 90;

export interface StatusDay {
  day: string;
  upCount: number;
  totalCount: number;
}

export interface StatusItem {
  id: string;
  /** Operator-chosen label. The monitor's target is never exposed publicly. */
  name: string;
  group: string | null;
  state: MonitorState;
  uptimePercent: number;
  days: StatusDay[];
}

export interface PublicIncident {
  id: string;
  severity: "DEGRADED" | "DOWN";
  startedAt: Date;
  resolvedAt: Date | null;
  monitorName: string;
  updates: { id: string; status: string; body: string; createdAt: Date }[];
}

export interface PublicStatus {
  title: string;
  description: string | null;
  items: StatusItem[];
  incidents: PublicIncident[];
  overall: MonitorState;
}

/**
 * Everything a public status page renders, for an anonymous caller.
 *
 * This is the inverse of the dashboard's trust model: there is no session, so
 * the page slug alone decides what is visible. Only monitors explicitly listed
 * as StatusPageItem rows are returned, and only the fields an operator
 * intended to publish — never `target`, never `Incident.cause`, never any
 * monitor merely belonging to the same organization.
 *
 * Non-public pages return null rather than their contents: password-gated
 * pages are not served until credential handling exists.
 */
export async function getPublicStatus(
  slug: string,
  now: Date = new Date(),
): Promise<PublicStatus | null> {
  const since = new Date(now.getTime() - STATUS_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const page = await prisma.statusPage.findUnique({
    where: { slug },
    select: {
      title: true,
      description: true,
      isPublic: true,
      passwordHash: true,
      items: {
        orderBy: { position: "asc" },
        select: {
          id: true,
          displayName: true,
          group: true,
          monitor: {
            select: {
              id: true,
              name: true,
              state: true,
              rollups: {
                where: { day: { gte: since } },
                orderBy: { day: "asc" },
                select: { day: true, upCount: true, totalCount: true },
              },
              incidents: {
                where: { OR: [{ resolvedAt: null }, { startedAt: { gte: since } }] },
                orderBy: { startedAt: "desc" },
                select: {
                  id: true,
                  severity: true,
                  startedAt: true,
                  resolvedAt: true,
                  updates: {
                    orderBy: { createdAt: "asc" },
                    select: { id: true, status: true, body: true, createdAt: true },
                  },
                },
              },
            },
          },
        },
      },
    },
  });

  if (!page || !page.isPublic || page.passwordHash !== null) {
    return null;
  }

  const items: StatusItem[] = page.items.map((item) => {
    const periods: IncidentPeriod[] = item.monitor.incidents.map((i) => ({
      start: i.startedAt,
      end: i.resolvedAt,
      severity: i.severity,
    }));

    const uptime = computeUptime({
      window: { start: since, end: now },
      incidents: periods,
      maintenance: [],
      countDegraded: false,
    });

    return {
      id: item.id,
      name: item.displayName ?? item.monitor.name,
      group: item.group,
      state: item.monitor.state,
      uptimePercent: uptime.uptimePercent,
      days: item.monitor.rollups.map((r) => ({
        day: r.day.toISOString().slice(0, 10),
        upCount: r.upCount,
        totalCount: r.totalCount,
      })),
    };
  });

  const incidents: PublicIncident[] = page.items
    .flatMap((item) =>
      item.monitor.incidents.map((i) => ({
        id: i.id,
        severity: i.severity,
        startedAt: i.startedAt,
        resolvedAt: i.resolvedAt,
        monitorName: item.displayName ?? item.monitor.name,
        updates: i.updates,
      })),
    )
    .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());

  return {
    title: page.title,
    description: page.description,
    items,
    incidents,
    overall: worstState(items.map((i) => i.state)),
  };
}
