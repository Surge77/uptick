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

/**
 * Deterministic value noise in [-1, 1].
 *
 * A modulo-based wobble produced a perfect sawtooth in the sparklines, which
 * read as obviously synthetic. Hashing the index and smoothing between whole
 * steps gives a curve that drifts like a real latency series while staying
 * reproducible across runs.
 */
function noise(seed: number, index: number): number {
  const at = (i: number) => {
    const x = Math.sin(seed * 374.761 + i * 91.7) * 43758.5453;
    return (x - Math.floor(x)) * 2 - 1;
  };
  const whole = Math.floor(index);
  const frac = index - whole;
  const smooth = frac * frac * (3 - 2 * frac);
  return at(whole) * (1 - smooth) + at(whole + 1) * smooth;
}

function seedOf(monitorId: string): number {
  return [...monitorId].reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
}

async function writeRollups(monitorId: string): Promise<void> {
  const latency = latencyFor(monitorId);
  const seed = seedOf(monitorId);

  for (let daysAgo = DAYS - 1; daysAgo >= 0; daysAgo -= 1) {
    const ratio = BAD_DAYS[monitorId]?.[daysAgo] ?? 1;
    const upCount = Math.round(CHECKS_PER_DAY * ratio);
    // Two octaves: a slow drift plus a smaller day-to-day wobble.
    const drift = noise(seed, daysAgo / 11) * 0.16;
    const wobble = noise(seed + 17, daysAgo / 2.5) * 0.07;
    // A bad day costs latency as well as availability.
    const stress = (1 - ratio) * 6;
    const jitter = Math.max(0.55, 1 + drift + wobble + stress);

    // Update and create carry the same fields: an update clause that omitted
    // the latency columns silently pinned them to whatever the first run
    // wrote, so re-running the script appeared to do nothing.
    const row = {
      upCount,
      totalCount: CHECKS_PER_DAY,
      p50Ms: Math.round(latency.p50 * jitter),
      p95Ms: Math.round(latency.p95 * jitter),
      p99Ms: Math.round(latency.p99 * jitter),
      minMs: Math.round(latency.p50 * 0.6),
      maxMs: Math.round(latency.p99 * 1.8),
      downtimeSec: Math.round((1 - ratio) * 86_400),
    };

    await prisma.checkRollup.upsert({
      where: { monitorId_day: { monitorId, day: midnightUtc(daysAgo) } },
      update: row,
      create: { monitorId, day: midnightUtc(daysAgo), ...row },
    });
  }
}

async function main(): Promise<void> {
  const monitorIds = Object.values(MONITORS);

  await prisma.incident.deleteMany({ where: { monitorId: { in: monitorIds } } });

  for (const monitorId of monitorIds) {
    await writeRollups(monitorId);
  }

  // Attribute the acknowledgement to a real user when one exists, so the feed
  // shows a name rather than an em dash. A freshly cloned database has no
  // users until someone signs in, hence the null fallback.
  const actor = await prisma.user.findFirst({ select: { id: true } });

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
      ackedById: actor?.id ?? null,
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
