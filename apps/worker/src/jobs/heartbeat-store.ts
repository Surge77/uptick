import type { PrismaClient } from "@uptick/db";
import { selectStale, type HeartbeatSweepResult } from "./heartbeat.js";

/** Database access for the heartbeat sweeper. Rules live in `heartbeat.ts`. */

/** Load heartbeats and select the stale ones. */
export async function findStaleHeartbeats(
  prisma: PrismaClient,
  now: Date,
): Promise<HeartbeatSweepResult> {
  const heartbeats = await prisma.heartbeat.findMany({
    where: { lastPingAt: { not: null } },
    select: { monitorId: true, graceSec: true, lastPingAt: true },
  });

  return selectStale(heartbeats, now);
}

/**
 * Record a synthetic check for each stale heartbeat.
 *
 * Writing a `Check` rather than opening an incident directly means heartbeats
 * flow through exactly the same verdict machine, confirmation thresholds and
 * quorum as every other monitor. A separate alerting path would need its own
 * flap suppression and its own dedup, and would drift.
 */
export async function recordHeartbeatChecks(
  prisma: PrismaClient,
  regionId: string,
  result: HeartbeatSweepResult,
  now: Date,
): Promise<void> {
  if (result.stale.length === 0) return;

  await prisma.check.createMany({
    data: result.stale.map((monitorId) => ({
      monitorId,
      regionId,
      ts: now,
      ok: false,
      latencyMs: null,
      error: "No heartbeat received within the grace period",
    })),
  });
}

/** Record a received ping. Returns false if the token is unknown. */
export async function recordPing(prisma: PrismaClient, token: string, now: Date): Promise<boolean> {
  const updated = await prisma.heartbeat.updateMany({
    where: { token },
    data: { lastPingAt: now },
  });
  return updated.count > 0;
}
