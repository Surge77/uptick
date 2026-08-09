import { overlapMs, type Interval } from "../time.js";

/** Edge of the dependency DAG: `monitorId` depends on `dependsOnId`. */
export interface DependencyEdge {
  monitorId: string;
  dependsOnId: string;
}

export interface OpenIncident {
  id: string;
  monitorId: string;
  startedAt: Date;
  /** Null while the incident is still running. */
  resolvedAt: Date | null;
}

export interface SuppressionResult {
  /** Incidents that should page: nothing upstream explains them. */
  roots: string[];
  /** incidentId → the ancestor incident it rolls up into. */
  suppressed: Map<string, string>;
}

const NO_EDGES: readonly string[] = [];

function toInterval(incident: OpenIncident): Interval {
  // An unresolved incident runs to "now" for overlap purposes; using a far
  // future bound keeps this function pure rather than reading the clock.
  return { start: incident.startedAt, end: incident.resolvedAt ?? new Date(8.64e15) };
}

/**
 * Decide which incidents are root causes and which are consequences.
 *
 * When a database goes down, every service depending on it fails too. Paging
 * for all of them buries the one alert that matters. This walks each failing
 * monitor's dependencies and, if an upstream monitor is failing over an
 * overlapping window, attributes the downstream incident to the upstream one.
 *
 * The nearest failing ancestor wins rather than the furthest: attributing an
 * API outage to the database it directly depends on is more actionable than
 * attributing it to something three hops away. Traversal is breadth-first for
 * that reason.
 *
 * Cycles are tolerated. The data model permits them even though the graph is
 * meant to be acyclic, and an operator mis-configuring a cycle should not hang
 * the scheduler.
 */
export function suppressIncidents(
  incidents: readonly OpenIncident[],
  edges: readonly DependencyEdge[],
): SuppressionResult {
  const dependsOn = new Map<string, string[]>();
  for (const edge of edges) {
    const existing = dependsOn.get(edge.monitorId);
    if (existing) {
      existing.push(edge.dependsOnId);
    } else {
      dependsOn.set(edge.monitorId, [edge.dependsOnId]);
    }
  }

  // Several incidents can share a monitor over time, so index by monitor and
  // filter on overlap at lookup.
  const byMonitor = new Map<string, OpenIncident[]>();
  for (const incident of incidents) {
    const existing = byMonitor.get(incident.monitorId);
    if (existing) {
      existing.push(incident);
    } else {
      byMonitor.set(incident.monitorId, [incident]);
    }
  }

  const suppressed = new Map<string, string>();
  const roots: string[] = [];

  for (const incident of incidents) {
    const ancestor = nearestFailingAncestor(incident, dependsOn, byMonitor);
    if (ancestor) {
      suppressed.set(incident.id, ancestor.id);
    } else {
      roots.push(incident.id);
    }
  }

  return { roots, suppressed };
}

/** Breadth-first walk up the dependency edges for a concurrently failing monitor. */
function nearestFailingAncestor(
  incident: OpenIncident,
  dependsOn: Map<string, string[]>,
  byMonitor: Map<string, OpenIncident[]>,
): OpenIncident | null {
  const window = toInterval(incident);
  const seen = new Set<string>([incident.monitorId]);
  let frontier = [...(dependsOn.get(incident.monitorId) ?? NO_EDGES)];

  while (frontier.length > 0) {
    const next: string[] = [];

    for (const monitorId of frontier) {
      if (seen.has(monitorId)) {
        continue;
      }
      seen.add(monitorId);

      const candidate = (byMonitor.get(monitorId) ?? []).find(
        (other) => other.id !== incident.id && overlapMs(toInterval(other), window) > 0,
      );
      if (candidate) {
        return candidate;
      }

      next.push(...(dependsOn.get(monitorId) ?? NO_EDGES));
    }

    frontier = next;
  }

  return null;
}
