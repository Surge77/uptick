/**
 * Live diagnostic for the `FOR UPDATE SKIP LOCKED` lease.
 *
 * Unit tests cannot prove this: the guarantee is a property of Postgres row
 * locking, and a mocked client models whatever we tell it to. Run it against a
 * real database whenever `leaseDueMonitors` is touched.
 *
 *   pnpm --filter @uptick/worker diag:lease
 *
 * Creates its own throwaway monitors, then deletes them.
 */
import { PrismaClient } from "@uptick/db";
import { leaseDueMonitors } from "../src/watch/lease.js";

const MONITOR_COUNT = 40;
const WORKERS = 4;
const BATCH = 15;
const PREFIX = "diag-lease-";

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const org = await prisma.organization.upsert({
    where: { slug: "diag" },
    update: {},
    create: { name: "Diagnostics", slug: "diag" },
  });

  await prisma.monitor.deleteMany({ where: { id: { startsWith: PREFIX } } });

  const past = new Date(Date.now() - 60_000);
  await prisma.monitor.createMany({
    data: Array.from({ length: MONITOR_COUNT }, (_, i) => ({
      id: `${PREFIX}${i}`,
      organizationId: org.id,
      name: `diag ${i}`,
      type: "HTTP" as const,
      target: "https://example.com",
      intervalSec: 3600,
      nextCheckAt: past,
    })),
  });

  // Every worker leases at the same instant against the same rows. Without
  // SKIP LOCKED these either block on each other or hand the same monitor to
  // two workers, which would double-probe the target and corrupt quorum by
  // making one machine look like agreement between two.
  const now = new Date();
  const batches = await Promise.all(
    Array.from({ length: WORKERS }, () => leaseDueMonitors(prisma, BATCH, now)),
  );

  const seen = new Map<string, number>();
  for (const batch of batches) {
    for (const monitor of batch) {
      seen.set(monitor.id, (seen.get(monitor.id) ?? 0) + 1);
    }
  }

  const duplicates = [...seen.entries()].filter(([, count]) => count > 1);
  const leasedTotal = batches.reduce((sum, b) => sum + b.length, 0);
  // Other monitors (seed data) may also be due; they prove the same point but
  // must not be counted against this run's arithmetic.
  const mine = [...seen.keys()].filter((id) => id.startsWith(PREFIX));

  console.warn(`workers            : ${WORKERS} x batch ${BATCH}`);
  console.warn(`monitors due       : ${MONITOR_COUNT}`);
  console.warn(`per-worker leases  : ${batches.map((b) => b.length).join(", ")}`);
  console.warn(`total leased       : ${leasedTotal}`);
  console.warn(`distinct leased    : ${seen.size} (${mine.length} created by this run)`);
  console.warn(`duplicates         : ${duplicates.length}`);

  // A leased monitor's next check must be pushed into the future, in the same
  // transaction. If it were not, the next tick would immediately re-lease it.
  const stillDue = await prisma.monitor.count({
    where: { id: { startsWith: PREFIX }, nextCheckAt: { lte: now } },
  });
  console.warn(`still due after    : ${stillDue} (expected ${MONITOR_COUNT - mine.length})`);

  await prisma.monitor.deleteMany({ where: { id: { startsWith: PREFIX } } });

  const ok =
    duplicates.length === 0 &&
    leasedTotal === seen.size &&
    stillDue === MONITOR_COUNT - mine.length;

  console.warn(ok ? "\nPASS: no monitor was leased twice" : "\nFAIL: lease is not exclusive");
  process.exitCode = ok ? 0 : 1;
}

main()
  .catch((error: unknown) => {
    console.error("diagnostic failed:", error);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
