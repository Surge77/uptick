import { prisma } from "../src/index.js";

/**
 * Populate realistic history for local development.
 *
 * The base seed creates configuration but no observations, so every surface
 * renders its empty state and the DOWN, DEGRADED, incident and error-budget
 * paths are never exercised. This fills in 90 days of rollups plus a resolved
 * outage and an ongoing degradation so those paths can be seen and checked.
 *
 * Idempotent: rollups upsert on (monitorId, day) and incidents are cleared for
 * the seeded monitors before being rewritten.
 */
const DAYS = 90;
const CHECKS_PER_DAY = 1440;

const MONITORS = {
  api: "seed-monitor-api",
  db: "seed-monitor-db",
  site: "seed-monitor-site",
};

/**
 * Days offset from today that should look imperfect, per monitor.
 *
 * Kept to shallow dips except on the day that carries a real incident, so the
 * strip and the uptime percentage tell the same story: availability is
 * computed from incident durations, not from these ratios, and a deep dip with
 * no matching incident would render as a red day beside a flawless number.
 */
const BAD_DAYS: Record<string, Record<number, number>> = {
  [MONITORS.api]: { 12: 0.982, 13: 0.9995, 41: 0.9994 },
  [MONITORS.db]: { 3: 0.9991 },
  [MONITORS.site]: { 27: 0.9997, 28: 0.9993 },
};

function midnightUtc(daysAgo: number): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - daysAgo);
  return d;
}

function latencyFor(monitorId: string): { p50: number; p95: number; p99: number } {
  if (monitorId === MONITORS.db) return { p50: 4, p95: 11, p99: 24 };
  if (monitorId === MONITORS.site) return { p50: 138, p95: 402, p99: 780 };
  return { p50: 87, p95: 243, p99: 512 };
}

async function writeRollups(monitorId: string): Promise<void> {
  const latency = latencyFor(monitorId);

  for (let daysAgo = DAYS - 1; daysAgo >= 0; daysAgo -= 1) {
    const ratio = BAD_DAYS[monitorId]?.[daysAgo] ?? 1;
    const upCount = Math.round(CHECKS_PER_DAY * ratio);
    const jitter = 1 + (daysAgo % 7) * 0.03;

    await prisma.checkRollup.upsert({
      where: { monitorId_day: { monitorId, day: midnightUtc(daysAgo) } },
      update: { upCount, totalCount: CHECKS_PER_DAY },
      create: {
        monitorId,
        day: midnightUtc(daysAgo),
        upCount,
        totalCount: CHECKS_PER_DAY,
        p50Ms: Math.round(latency.p50 * jitter),
        p95Ms: Math.round(latency.p95 * jitter),
        p99Ms: Math.round(latency.p99 * jitter),
        minMs: Math.round(latency.p50 * 0.6),
        maxMs: Math.round(latency.p99 * 1.8),
        downtimeSec: Math.round((1 - ratio) * 86_400),
      },
    });
  }
}

async function main(): Promise<void> {
  const monitorIds = Object.values(MONITORS);

  await prisma.incident.deleteMany({ where: { monitorId: { in: monitorIds } } });

  for (const monitorId of monitorIds) {
    await writeRollups(monitorId);
  }

  // A resolved outage with a public timeline, to exercise the incident feed.
  const resolved = await prisma.incident.create({
    data: {
      monitorId: MONITORS.api,
      severity: "DOWN",
      startedAt: new Date(midnightUtc(12).getTime() + 9 * 3_600_000),
      resolvedAt: new Date(midnightUtc(12).getTime() + 9 * 3_600_000 + 25 * 60_000),
      cause: "Upstream connection pool exhausted",
      failingRegions: ["fra", "iad"],
      ackedAt: new Date(midnightUtc(12).getTime() + 9 * 3_600_000 + 4 * 60_000),
    },
    select: { id: true },
  });

  const updates = [
    ["INVESTIGATING", "We are investigating elevated error rates on the API."],
    ["IDENTIFIED", "A connection pool exhaustion on the primary database was identified."],
    ["MONITORING", "A fix has been applied and error rates are returning to normal."],
    ["RESOLVED", "The API has been stable for 15 minutes. This incident is resolved."],
  ] as const;

  for (const [index, [status, body]] of updates.entries()) {
    await prisma.incidentUpdate.create({
      data: {
        incidentId: resolved.id,
        status,
        body,
        createdAt: new Date(midnightUtc(12).getTime() + 9 * 3_600_000 + index * 6 * 60_000),
      },
    });
  }

  // An ongoing degradation, so the DEGRADED styling and "ongoing" states render.
  await prisma.incident.create({
    data: {
      monitorId: MONITORS.site,
      severity: "DEGRADED",
      startedAt: new Date(Date.now() - 42 * 60_000),
      cause: "Elevated latency from the CDN edge",
      failingRegions: ["sin"],
    },
  });

  await prisma.monitor.update({
    where: { id: MONITORS.api },
    data: { state: "UP", lastCheckAt: new Date() },
  });
  await prisma.monitor.update({
    where: { id: MONITORS.db },
    data: { state: "UP", lastCheckAt: new Date() },
  });
  await prisma.monitor.update({
    where: { id: MONITORS.site },
    data: { state: "DEGRADED", lastCheckAt: new Date() },
  });

  console.warn(
    JSON.stringify({
      rollups: await prisma.checkRollup.count(),
      incidents: await prisma.incident.count(),
      updates: await prisma.incidentUpdate.count(),
    }),
  );
}

main()
  .catch((error: unknown) => {
    console.error("demo seed failed:", error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
