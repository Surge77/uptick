import type { NotificationKind } from "@uptick/core";
import type { PrismaClient } from "@uptick/db";
import { DEFAULT_FLAP_WINDOW_MS, evaluateMonitor, type Evaluation } from "./evaluator.js";
import {
  applyEvaluation,
  loadMaintenanceCoverage,
  loadObservations,
  loadOpenIncidents,
  loadRecentTransitions,
} from "./store.js";

/**
 * Evaluate the monitors touched by a tick and persist the resulting incidents.
 *
 * Runs after checks are written, not interleaved with probing: the verdict
 * needs the tick's own results to be visible, and batching the loads keeps this
 * to a handful of queries regardless of batch size.
 */

/** Emitted after a transition is persisted, so alerting can follow it. */
export type IncidentNotifier = (incidentId: string, kind: NotificationKind) => Promise<void>;

export interface PipelineSummary {
  evaluated: number;
  opened: number;
  resolved: number;
  severityChanged: number;
  suppressed: number;
}

export async function evaluateAndApply(
  prisma: PrismaClient,
  monitorIds: readonly string[],
  now: Date,
  onError: (context: string, error: unknown) => void,
  notify?: IncidentNotifier,
): Promise<PipelineSummary> {
  const summary: PipelineSummary = {
    evaluated: 0,
    opened: 0,
    resolved: 0,
    severityChanged: 0,
    suppressed: 0,
  };

  if (monitorIds.length === 0) return summary;

  const [monitors, observations, openIncidents, maintenance, transitions, activeRegionCount] =
    await Promise.all([
      prisma.monitor.findMany({
        where: { id: { in: [...monitorIds] } },
        select: {
          id: true,
          state: true,
          confirmThreshold: true,
          recoverThreshold: true,
          degradedMs: true,
          quorum: true,
        },
      }),
      loadObservations(prisma, monitorIds),
      loadOpenIncidents(prisma, monitorIds),
      loadMaintenanceCoverage(prisma, now),
      loadRecentTransitions(prisma, monitorIds, new Date(now.getTime() - DEFAULT_FLAP_WINDOW_MS)),
      prisma.region.count({ where: { active: true } }),
    ]);

  for (const monitor of monitors) {
    let evaluation: Evaluation;
    try {
      evaluation = evaluateMonitor({
        policy: {
          monitorId: monitor.id,
          confirmThreshold: monitor.confirmThreshold,
          recoverThreshold: monitor.recoverThreshold,
          degradedMs: monitor.degradedMs,
          quorum: monitor.quorum,
          state: monitor.state,
        },
        observations: observations.get(monitor.id) ?? [],
        activeRegionCount,
        openIncident: openIncidents.get(monitor.id) ?? null,
        recentTransitions: transitions.get(monitor.id) ?? [],
        isFlapping: false,
        inMaintenance: maintenance.has(monitor.id),
        now,
      });
    } catch (error) {
      onError(`evaluate ${monitor.id}`, error);
      continue;
    }

    summary.evaluated += 1;
    if (evaluation.suppressed) summary.suppressed += 1;

    const unchanged = evaluation.action.kind === "NONE" && evaluation.nextState === monitor.state;
    if (unchanged) continue;

    try {
      await applyEvaluation(prisma, monitor.id, evaluation.action, evaluation.nextState, now);

      if (evaluation.action.kind === "OPEN") summary.opened += 1;
      if (evaluation.action.kind === "RESOLVE") summary.resolved += 1;
      if (evaluation.action.kind === "CHANGE_SEVERITY") summary.severityChanged += 1;

      // Alerting follows persistence, never precedes it. Paging for an incident
      // that failed to commit would report an outage with no record behind it.
      if (notify) {
        const incidentId = await resolveIncidentId(prisma, monitor.id, evaluation.action);
        const kind = notificationKindFor(evaluation.action);
        if (incidentId && kind) {
          await notify(incidentId, kind).catch((error: unknown) =>
            onError(`notify ${incidentId}`, error),
          );
        }
      }
    } catch (error) {
      // One monitor failing to persist must not abandon the rest of the batch.
      onError(`applyEvaluation ${monitor.id}`, error);
    }
  }

  return summary;
}

/** The incident an action refers to, resolving OPEN to the row just created. */
async function resolveIncidentId(
  prisma: PrismaClient,
  monitorId: string,
  action: Evaluation["action"],
): Promise<string | null> {
  if (action.kind === "RESOLVE" || action.kind === "CHANGE_SEVERITY") return action.incidentId;
  if (action.kind !== "OPEN") return null;

  const latest = await prisma.incident.findFirst({
    where: { monitorId },
    orderBy: { startedAt: "desc" },
    select: { id: true },
  });
  return latest?.id ?? null;
}

function notificationKindFor(action: Evaluation["action"]): NotificationKind | null {
  switch (action.kind) {
    case "OPEN":
      return "OPENED";
    case "RESOLVE":
      return "RESOLVED";
    case "CHANGE_SEVERITY":
      return action.severity === "DOWN" ? "ESCALATED" : "DOWNGRADED";
    case "NONE":
      return null;
  }
}
