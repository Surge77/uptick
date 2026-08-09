/**
 * Live diagnostic for notification dedup and suppression.
 *
 * Asserts the guarantees this phase exists to provide, against a real database
 * with a capturing delivery adapter (nothing is actually sent):
 *
 *   - ten consecutive failures produce exactly ONE notification
 *   - a maintenance window produces ZERO
 *   - an unverified channel produces ZERO
 *   - recovery produces exactly one more
 *
 *   pnpm --filter @uptick/worker diag:alerts
 */
import { PrismaClient } from "@uptick/db";
import type { DeliveryDeps } from "../src/herald/channels.js";
import { evaluateAndApply } from "../src/incidents/pipeline.js";
import { dispatchForIncident } from "../src/herald/dispatcher.js";

const PREFIX = "diag-alert-";
const prisma = new PrismaClient();

const sent: string[] = [];
const failures: string[] = [];

/** Captures deliveries instead of performing them. */
const capturing: DeliveryDeps = {
  post: async (url) => {
    sent.push(url);
    return 200;
  },
  sendEmail: async (to, subject) => {
    sent.push(`${to}:${subject}`);
  },
  resolve: async () => ["93.184.216.34"],
};

function check(label: string, actual: unknown, expected: unknown): void {
  const ok = actual === expected;
  console.warn(
    `${ok ? "PASS" : "FAIL"}  ${label}: ${String(actual)} (expected ${String(expected)})`,
  );
  if (!ok) failures.push(label);
}

async function cleanup(): Promise<void> {
  await prisma.notification.deleteMany({
    where: { incident: { monitorId: { startsWith: PREFIX } } },
  });
  await prisma.incident.deleteMany({ where: { monitorId: { startsWith: PREFIX } } });
  await prisma.check.deleteMany({ where: { monitorId: { startsWith: PREFIX } } });
  await prisma.monitorChannel.deleteMany({ where: { monitorId: { startsWith: PREFIX } } });
  await prisma.monitor.deleteMany({ where: { id: { startsWith: PREFIX } } });
  await prisma.maintenanceWindow.deleteMany({ where: { title: { startsWith: PREFIX } } });
  await prisma.notificationChannel.deleteMany({ where: { name: { startsWith: PREFIX } } });
}

async function main(): Promise<void> {
  const org = await prisma.organization.upsert({
    where: { slug: "diag" },
    update: {},
    create: { name: "Diagnostics", slug: "diag" },
  });

  const regions = await prisma.region.findMany({
    where: { active: true },
    select: { id: true },
  });
  if (regions.length < 2) throw new Error("need two active regions; run pnpm db:seed");
  const [fra, iad] = regions;

  await cleanup();

  const verified = await prisma.notificationChannel.create({
    data: {
      organizationId: org.id,
      name: `${PREFIX}webhook`,
      type: "WEBHOOK",
      config: { url: "https://hooks.example.com/uptick" },
      verified: true,
      enabled: true,
    },
  });

  const unverified = await prisma.notificationChannel.create({
    data: {
      organizationId: org.id,
      name: `${PREFIX}unverified`,
      type: "WEBHOOK",
      config: { url: "https://hooks.example.com/nope" },
      verified: false,
      enabled: true,
    },
  });

  const noisyId = `${PREFIX}noisy`;
  const quietId = `${PREFIX}maintenance`;

  await prisma.monitor.createMany({
    data: [noisyId, quietId].map((id) => ({
      id,
      organizationId: org.id,
      name: id,
      type: "HTTP" as const,
      target: "https://example.com",
      intervalSec: 60,
      active: false,
    })),
  });

  await prisma.monitorChannel.createMany({
    data: [noisyId, quietId].flatMap((monitorId) => [
      { monitorId, channelId: verified.id },
      { monitorId, channelId: unverified.id },
    ]),
  });

  const base = Date.now();
  const at = (m: number) => new Date(base + m * 60_000);

  // The maintenance monitor is covered for the whole exercise.
  await prisma.maintenanceWindow.create({
    data: {
      organizationId: org.id,
      title: `${PREFIX}window`,
      startsAt: at(-60),
      endsAt: at(600),
      monitorIds: [quietId],
    },
  });

  const notify = async (incidentId: string, kind: Parameters<typeof dispatchForIncident>[2]) => {
    await dispatchForIncident(prisma, incidentId, kind, capturing, at(100), (c, e) =>
      console.error("error", c, e),
    );
  };

  // Ten consecutive failures across two regions.
  for (let i = 0; i < 10; i += 1) {
    for (const monitorId of [noisyId, quietId]) {
      for (const region of [fra!, iad!]) {
        await prisma.check.create({
          data: {
            monitorId,
            regionId: region.id,
            ts: at(i),
            ok: false,
            error: "ECONNREFUSED",
          },
        });
      }
    }
    await evaluateAndApply(
      prisma,
      [noisyId, quietId],
      at(i + 1),
      (c, e) => console.error("error", c, e),
      notify,
    );
  }

  const noisyNotifications = await prisma.notification.count({
    where: { incident: { monitorId: noisyId } },
  });
  check("notifications after 10 failures", noisyNotifications, 1);

  const quietNotifications = await prisma.notification.count({
    where: { incident: { monitorId: quietId } },
  });
  check("notifications during maintenance", quietNotifications, 0);

  check(
    "incidents opened during maintenance",
    await prisma.incident.count({ where: { monitorId: quietId } }),
    0,
  );

  const toUnverified = await prisma.notification.count({
    where: { channelId: unverified.id },
  });
  check("notifications to unverified channel", toUnverified, 0);

  check("deliveries attempted", sent.length, 1);

  // Recovery: two consecutive successes.
  for (let i = 11; i < 13; i += 1) {
    for (const region of [fra!, iad!]) {
      await prisma.check.create({
        data: { monitorId: noisyId, regionId: region.id, ts: at(i), ok: true, latencyMs: 80 },
      });
    }
  }
  await evaluateAndApply(prisma, [noisyId], at(14), (c, e) => console.error("error", c, e), notify);

  check(
    "notifications after recovery",
    await prisma.notification.count({ where: { incident: { monitorId: noisyId } } }),
    2,
  );
  check("total deliveries", sent.length, 2);

  await cleanup();

  console.warn(
    failures.length === 0
      ? "\nPASS: ten failures produce one alert, maintenance produces none"
      : `\nFAIL: ${failures.join(", ")}`,
  );
  process.exitCode = failures.length === 0 ? 0 : 1;
}

main()
  .catch((error: unknown) => {
    console.error("diagnostic failed:", error);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
