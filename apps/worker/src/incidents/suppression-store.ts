import { suppressIncidents, type DependencyEdge, type OpenIncident } from "@uptick/core";
import type { PrismaClient } from "@uptick/db";

/**
 * Decide which of the currently open incidents are consequences of another.
 *
 * Scoped to the organizations touched by this tick rather than the whole
 * table: dependency edges never cross an organization, so a wider load would
 * cost more and change nothing.
 */
export async function computeSuppression(
  prisma: PrismaClient,
  monitorIds: readonly string[],
): Promise<Map<string, string>> {
  if (monitorIds.length === 0) return new Map();

  const organizationIds = await organizationsOf(prisma, monitorIds);
  if (organizationIds.length === 0) return new Map();

  const [incidents, edges] = await Promise.all([
    loadOpenIncidents(prisma, organizationIds),
    loadEdges(prisma, organizationIds),
  ]);

  return suppressIncidents(incidents, edges).suppressed;
}

async function organizationsOf(
  prisma: PrismaClient,
  monitorIds: readonly string[],
): Promise<string[]> {
  const rows = await prisma.monitor.findMany({
    where: { id: { in: [...monitorIds] } },
    select: { organizationId: true },
    distinct: ["organizationId"],
  });
  return rows.map((r) => r.organizationId);
}

async function loadOpenIncidents(
  prisma: PrismaClient,
  organizationIds: readonly string[],
): Promise<OpenIncident[]> {
  const rows = await prisma.incident.findMany({
    where: {
      resolvedAt: null,
      monitor: { organizationId: { in: [...organizationIds] } },
    },
    select: { id: true, monitorId: true, startedAt: true, resolvedAt: true },
  });
  return rows;
}

async function loadEdges(
  prisma: PrismaClient,
  organizationIds: readonly string[],
): Promise<DependencyEdge[]> {
  const rows = await prisma.monitorDependency.findMany({
    where: { monitor: { organizationId: { in: [...organizationIds] } } },
    select: { monitorId: true, dependsOnId: true },
  });
  return rows;
}

/**
 * Persist the parent link for suppressed incidents.
 *
 * Written even though alerting already consulted the same map, so the
 * dashboard and any later replay can see why an incident did not page.
 */
export async function persistParentLinks(
  prisma: PrismaClient,
  suppressed: ReadonlyMap<string, string>,
): Promise<void> {
  const updates = [...suppressed.entries()].map(([incidentId, parentIncidentId]) =>
    prisma.incident.updateMany({
      where: { id: incidentId, parentIncidentId: null },
      data: { parentIncidentId },
    }),
  );

  if (updates.length > 0) {
    await prisma.$transaction(updates);
  }
}
