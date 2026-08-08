import {
  buildAlert,
  dedupeKey,
  nextEscalationLevel,
  routeNotification,
  type NotificationKind,
  type QuietHours,
  type RoutingChannel,
} from "@uptick/core";
import type { PrismaClient } from "@uptick/db";
import { deliver, type ChannelType, type DeliveryDeps } from "./channels.js";

/**
 * Notification dispatch.
 *
 * At-most-once is enforced by the UNIQUE constraint on `Notification.dedupeKey`
 * rather than by application logic. That matters because the guarantee then
 * survives a crash between deciding to send and recording the send, and
 * survives two workers evaluating the same incident at once. An in-memory
 * guard survives neither.
 */

export const ESCALATION_STEP_MINUTES = 15;
export const MAX_ESCALATION_LEVEL = 3;

export interface DispatchSummary {
  considered: number;
  sent: number;
  suppressed: number;
  duplicates: number;
  failed: number;
  escalated: number;
}

function parseQuietHours(config: unknown): QuietHours | null {
  if (typeof config !== "object" || config === null) return null;
  const record = config as Record<string, unknown>;
  const start = record.quietStartMinute;
  const end = record.quietEndMinute;
  if (typeof start !== "number" || typeof end !== "number") return null;
  return { startMinute: start, endMinute: end };
}

/** True when the error is Prisma's unique-constraint violation. */
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" && error !== null && (error as { code?: string }).code === "P2002"
  );
}

/**
 * Send notifications for one incident transition.
 *
 * The `Notification` row is created BEFORE delivery is attempted. Delivering
 * first and recording after leaves a window where a crash re-sends on the next
 * tick; claiming the key first means the worst case is a missed alert that is
 * visible in the table, which is far easier to reason about than a duplicate
 * page at 3am.
 */
export async function dispatchForIncident(
  prisma: PrismaClient,
  incidentId: string,
  kind: NotificationKind,
  deps: DeliveryDeps,
  now: Date,
  onError: (context: string, error: unknown) => void,
): Promise<DispatchSummary> {
  const summary: DispatchSummary = {
    considered: 0,
    sent: 0,
    suppressed: 0,
    duplicates: 0,
    failed: 0,
    escalated: 0,
  };

  const incident = await prisma.incident.findUnique({
    where: { id: incidentId },
    select: {
      id: true,
      severity: true,
      startedAt: true,
      resolvedAt: true,
      cause: true,
      failingRegions: true,
      escalationLevel: true,
      isFlapping: true,
      monitor: {
        select: {
          id: true,
          name: true,
          target: true,
          organizationId: true,
          channelLinks: {
            select: {
              channel: {
                select: {
                  id: true,
                  type: true,
                  config: true,
                  enabled: true,
                  verified: true,
                  tier: true,
                },
              },
            },
          },
        },
      },
    },
  });

  if (!incident) return summary;

  // A flapping monitor is already suppressed upstream, but an incident can
  // start flapping after it opened. Resolution still goes out.
  if (incident.isFlapping && kind !== "RESOLVED") {
    summary.suppressed += 1;
    return summary;
  }

  const channels: RoutingChannel[] = incident.monitor.channelLinks.map((link) => ({
    id: link.channel.id,
    tier: link.channel.tier,
    enabled: link.channel.enabled,
    verified: link.channel.verified,
    quietHours: parseQuietHours(link.channel.config),
  }));

  const decisions = routeNotification({
    kind,
    channels,
    level: incident.escalationLevel,
    now,
  });

  const message = buildAlert({
    kind,
    monitorName: incident.monitor.name,
    monitorTarget: incident.monitor.target,
    severity: incident.severity,
    cause: incident.cause,
    startedAt: incident.startedAt,
    resolvedAt: incident.resolvedAt,
    failingRegions: incident.failingRegions,
    level: incident.escalationLevel,
    now,
  });

  for (const decision of decisions) {
    summary.considered += 1;

    if (!decision.send) {
      summary.suppressed += 1;
      continue;
    }

    const key = dedupeKey({
      incidentId,
      channelId: decision.channelId,
      kind,
      level: incident.escalationLevel,
    });

    let notificationId: string;
    try {
      const created = await prisma.notification.create({
        data: {
          incidentId,
          channelId: decision.channelId,
          dedupeKey: key,
          state: "PENDING",
        },
        select: { id: true },
      });
      notificationId = created.id;
    } catch (error) {
      if (isUniqueViolation(error)) {
        // Already claimed by an earlier attempt or a concurrent worker. This is
        // the mechanism working, not a fault.
        summary.duplicates += 1;
        continue;
      }
      onError(`claim notification ${key}`, error);
      summary.failed += 1;
      continue;
    }

    const link = incident.monitor.channelLinks.find((l) => l.channel.id === decision.channelId);
    if (!link) continue;

    try {
      await deliver(
        {
          type: link.channel.type as ChannelType,
          config: (link.channel.config ?? {}) as Record<string, unknown>,
          message,
          monitorName: incident.monitor.name,
        },
        deps,
      );

      await prisma.notification.update({
        where: { id: notificationId },
        data: { state: "SENT", sentAt: now, attempts: { increment: 1 } },
      });
      summary.sent += 1;
    } catch (error) {
      await prisma.notification
        .update({
          where: { id: notificationId },
          data: {
            state: "FAILED",
            attempts: { increment: 1 },
            error: error instanceof Error ? error.message : String(error),
          },
        })
        .catch(() => undefined);

      onError(`deliver ${decision.channelId}`, error);
      summary.failed += 1;
    }
  }

  return summary;
}

/**
 * Advance escalation for unacknowledged incidents and page the next tier.
 *
 * Escalation is computed from elapsed time rather than counted per tick, so a
 * worker that was down for an hour lands on the correct tier immediately
 * instead of walking up one level per tick and sending a burst of pages.
 */
export async function runEscalations(
  prisma: PrismaClient,
  deps: DeliveryDeps,
  now: Date,
  onError: (context: string, error: unknown) => void,
): Promise<number> {
  const open = await prisma.incident.findMany({
    where: { resolvedAt: null, ackedAt: null, isFlapping: false },
    select: { id: true, startedAt: true, escalationLevel: true },
  });

  let escalated = 0;

  for (const incident of open) {
    const next = nextEscalationLevel({
      openedAt: incident.startedAt,
      ackedAt: null,
      resolvedAt: null,
      currentLevel: incident.escalationLevel,
      stepMinutes: ESCALATION_STEP_MINUTES,
      maxLevel: MAX_ESCALATION_LEVEL,
      now,
    });

    if (next === null) continue;

    try {
      await prisma.incident.update({
        where: { id: incident.id },
        data: { escalationLevel: next },
      });
      await dispatchForIncident(prisma, incident.id, "ESCALATION", deps, now, onError);
      escalated += 1;
    } catch (error) {
      onError(`escalate ${incident.id}`, error);
    }
  }

  return escalated;
}
