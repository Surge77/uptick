/**
 * Development seed.
 *
 * Idempotent: every write is an upsert keyed on a natural unique column, so
 * re-running never duplicates rows and never fails on a partially seeded
 * database.
 */
import { randomUUID } from "node:crypto";
import { PrismaClient } from "../generated/client/index.js";

const prisma = new PrismaClient();

const REGIONS = [
  { slug: "fra", label: "Frankfurt", active: true },
  { slug: "iad", label: "N. Virginia", active: true },
  { slug: "sin", label: "Singapore", active: true },
  { slug: "local", label: "Local development", active: false },
];

async function main() {
  for (const region of REGIONS) {
    await prisma.region.upsert({
      where: { slug: region.slug },
      update: { label: region.label },
      create: region,
    });
  }

  const org = await prisma.organization.upsert({
    where: { slug: "acme" },
    update: {},
    create: { name: "Acme Inc", slug: "acme" },
  });

  const api = await prisma.monitor.upsert({
    where: { id: "seed-monitor-api" },
    update: {},
    create: {
      id: "seed-monitor-api",
      organizationId: org.id,
      name: "Acme API",
      type: "HTTP",
      target: "https://example.com/health",
      intervalSec: 60,
      degradedMs: 1500,
      assertions: { expectedStatus: 200 },
    },
  });

  const db = await prisma.monitor.upsert({
    where: { id: "seed-monitor-db" },
    update: {},
    create: {
      id: "seed-monitor-db",
      organizationId: org.id,
      name: "Acme Postgres",
      type: "TCP",
      target: "example.com:5432",
      intervalSec: 120,
    },
  });

  const site = await prisma.monitor.upsert({
    where: { id: "seed-monitor-site" },
    update: {},
    create: {
      id: "seed-monitor-site",
      organizationId: org.id,
      name: "Acme Marketing Site",
      type: "HTTP",
      target: "https://example.com",
      intervalSec: 300,
      assertions: { expectedStatus: 200, bodyContains: "Example" },
    },
  });

  const nightly = await prisma.monitor.upsert({
    where: { id: "seed-monitor-nightly" },
    update: {},
    create: {
      id: "seed-monitor-nightly",
      organizationId: org.id,
      name: "Nightly ETL job",
      type: "HEARTBEAT",
      target: "nightly-etl",
      intervalSec: 86_400,
    },
  });

  await prisma.heartbeat.upsert({
    where: { monitorId: nightly.id },
    update: {},
    create: { monitorId: nightly.id, token: randomUUID(), graceSec: 3600 },
  });

  // The API depends on the database. Phase 9 uses this edge to roll the API's
  // incident into the database's, so a Postgres outage pages once rather than
  // once per dependent service.
  await prisma.monitorDependency.upsert({
    where: { monitorId_dependsOnId: { monitorId: api.id, dependsOnId: db.id } },
    update: {},
    create: { monitorId: api.id, dependsOnId: db.id },
  });

  for (const monitor of [api, db]) {
    await prisma.sloTarget.upsert({
      where: { monitorId_windowDays: { monitorId: monitor.id, windowDays: 30 } },
      update: {},
      create: { monitorId: monitor.id, objective: 99.9, windowDays: 30 },
    });
  }

  const statusPage = await prisma.statusPage.upsert({
    where: { slug: "acme" },
    update: {},
    create: {
      organizationId: org.id,
      slug: "acme",
      title: "Acme Status",
      description: "Live and historical availability for Acme services.",
    },
  });

  const published = [api, site, db];
  for (const [position, monitor] of published.entries()) {
    await prisma.statusPageItem.upsert({
      where: {
        statusPageId_monitorId: { statusPageId: statusPage.id, monitorId: monitor.id },
      },
      update: { position },
      create: { statusPageId: statusPage.id, monitorId: monitor.id, position },
    });
  }

  const counts = {
    regions: await prisma.region.count(),
    monitors: await prisma.monitor.count(),
    dependencies: await prisma.monitorDependency.count(),
    sloTargets: await prisma.sloTarget.count(),
    statusPageItems: await prisma.statusPageItem.count(),
  };
  console.warn("seed complete:", JSON.stringify(counts));
}

main()
  .catch((error: unknown) => {
    console.error("seed failed:", error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
