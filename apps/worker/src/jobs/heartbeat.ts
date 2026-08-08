import type { PrismaClient } from "@uptick/db";

/**
 * Heartbeat staleness sweeper.
 *
 * Heartbeat monitors are push-based: the job calls us. There is nothing for the
 * scheduler to probe, so the alert condition is silence, and silence has to be
 * looked for rather than observed.
 */

export interface HeartbeatSweepResult {
  checked: number;
  stale: string[];
}

/**
 * Find heartbeats whose last ping is older than their grace period.
 *
 * A heartbeat that has NEVER pinged is not stale: a monitor created five
 * minutes ago whose job runs nightly would otherwise alert immediately, before
 * the job has had any opportunity to run. Staleness is measured from the last
 * ping, and absence of a first ping is simply "not yet reporting".
 */
export async function findStaleHeartbeats(
  prisma: PrismaClient,
  now: Date,
): Promise<HeartbeatSweepResult> {
  const heartbeats = await prisma.heartbeat.findMany({
    where: { lastPingAt: { not: null } },
    select: { monitorId: true, graceSec: true, lastPingAt: true },
  });

  const stale = heartbeats
    .filter((hb) => {
      const deadline = hb.lastPingAt!.getTime() + hb.graceSec * 1000;
      return now.getTime() > deadline;
    })
    .map((hb) => hb.monitorId);

  return { checked: heartbeats.length, stale };
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
