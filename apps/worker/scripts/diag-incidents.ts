/**
 * Live diagnostic for the check -> incident pipeline.
 *
 * Drives real checks through the real evaluator against a real database and
 * asserts the headline guarantees:
 *
 *   - three consecutive failures across two regions open EXACTLY one incident
 *   - further failures do not open a second
 *   - two consecutive successes resolve it
 *   - a single region failing opens nothing
 *
 *   pnpm --filter @uptick/worker diag:incidents
 *
 * Creates its own throwaway data and removes it afterwards.
 */
import { PrismaClient } from "@uptick/db";
import { evaluateAndApply } from "../src/incidents/pipeline.js";

const PREFIX = "diag-inc-";
const prisma = new PrismaClient();

const failures: string[] = [];

function check(label: string, actual: unknown, expected: unknown): void {
  const ok = actual === expected;
  console.warn(
    `${ok ? "PASS" : "FAIL"}  ${label}: ${String(actual)} (expected ${String(expected)})`,
  );
  if (!ok) failures.push(label);
}

async function writeCheck(
  monitorId: string,
  regionId: string,
  ok: boolean,
  at: Date,
): Promise<void> {
  await prisma.check.create({
    data: {
      monitorId,
      regionId,
      ts: at,
      ok,
      latencyMs: ok ? 100 : null,
      error: ok ? null : "ECONNREFUSED",
    },
  });
}

async function countIncidents(monitorId: string): Promise<number> {
  return prisma.incident.count({ where: { monitorId } });
}

async function cleanup(): Promise<void> {
  await prisma.incident.deleteMany({ where: { monitorId: { startsWith: PREFIX } } });
  await prisma.check.deleteMany({ where: { monitorId: { startsWith: PREFIX } } });
  await prisma.monitor.deleteMany({ where: { id: { startsWith: PREFIX } } });
}

async function main(): Promise<void> {
  const org = await prisma.organization.upsert({
    where: { slug: "diag" },
    update: {},
    create: { name: "Diagnostics", slug: "diag" },
  });

  const regions = await prisma.region.findMany({
    where: { active: true },
    select: { id: true, slug: true },
  });
  if (regions.length < 2) throw new Error("need at least two active regions; run pnpm db:seed");
  const [fra, iad] = regions;

  await cleanup();

  const quorumId = `${PREFIX}quorum`;
  const singleId = `${PREFIX}single`;
  await prisma.monitor.createMany({
    data: [quorumId, singleId].map((id) => ({
      id,
      organizationId: org.id,
      name: id,
      type: "HTTP" as const,
      target: "https://example.com",
      intervalSec: 60,
      active: false, // keep the live scheduler from touching these
    })),
  });

  const base = Date.now();
  const at = (offsetMin: number) => new Date(base + offsetMin * 60_000);
  const run = async (offsetMin: number) =>
    evaluateAndApply(prisma, [quorumId, singleId], at(offsetMin), (c, e) =>
      console.error("error", c, e),
    );

  // Two regions fail together, three times: the confirmation threshold.
  for (let i = 0; i < 3; i += 1) {
    await writeCheck(quorumId, fra!.id, false, at(i));
    await writeCheck(quorumId, iad!.id, false, at(i));
    // Only one region fails for the control monitor.
    await writeCheck(singleId, fra!.id, false, at(i));
    await writeCheck(singleId, iad!.id, true, at(i));
  }

  await run(4);
  check("incidents after 3 confirmed failures", await countIncidents(quorumId), 1);
  check("incidents for single-region failure", await countIncidents(singleId), 0);

  // Keep failing. This must NOT open a second incident.
  for (let i = 5; i < 9; i += 1) {
    await writeCheck(quorumId, fra!.id, false, at(i));
    await writeCheck(quorumId, iad!.id, false, at(i));
    await run(i + 1);
  }
  check("incidents after 7 more failures", await countIncidents(quorumId), 1);

  const stillOpen = await prisma.incident.count({
    where: { monitorId: quorumId, resolvedAt: null },
  });
  check("incident still open", stillOpen, 1);

  // Two consecutive successes: the recovery threshold.
  for (let i = 10; i < 12; i += 1) {
    await writeCheck(quorumId, fra!.id, true, at(i));
    await writeCheck(quorumId, iad!.id, true, at(i));
  }
  await run(13);

  check("incidents after recovery", await countIncidents(quorumId), 1);
  check(
    "incident resolved",
    await prisma.incident.count({ where: { monitorId: quorumId, resolvedAt: { not: null } } }),
    1,
  );
  check(
    "monitor state after recovery",
    (await prisma.monitor.findUnique({ where: { id: quorumId }, select: { state: true } }))?.state,
    "UP",
  );

  const updates = await prisma.incidentUpdate.count({
    where: { incident: { monitorId: quorumId } },
  });
  check("timeline updates (opened + resolved)", updates, 2);

  await cleanup();

  console.warn(
    failures.length === 0
      ? "\nPASS: three failures open exactly one incident, two successes resolve it"
      : `\nFAIL: ${failures.length} assertion(s) failed: ${failures.join(", ")}`,
  );
  process.exitCode = failures.length === 0 ? 0 : 1;
}

main()
  .catch((error: unknown) => {
    console.error("diagnostic failed:", error);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
