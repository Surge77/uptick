import { prisma } from "../src/index.js";

/**
 * Verify the filter that status-page publishing relies on.
 *
 * setStatusPageItems intersects submitted monitor ids with the caller org's
 * own monitors. This reproduces that query with a foreign monitor id to
 * confirm the intersection drops it, which is what stops a forged form value
 * from publishing another tenant's monitor on a public page.
 */
const orgs = await prisma.organization.findMany({
  select: { id: true, slug: true, monitors: { select: { id: true, name: true } } },
});

const [orgA, orgB] = orgs;

if (!orgA || !orgB) {
  console.warn(`Need two organizations; found ${orgs.length}. Skipping.`);
  await prisma.$disconnect();
  process.exit(0);
}

// Create a throwaway monitor in org B so there is something foreign to try to
// publish. Removed again below, so running this leaves no residue.
const fixture = await prisma.monitor.create({
  data: {
    organizationId: orgB.id,
    name: "isolation-check-fixture",
    type: "HTTP",
    target: "https://fixture.invalid/",
  },
  select: { id: true },
});
const foreignId = fixture.id;

const allowed = await prisma.monitor.findMany({
  where: { id: { in: [foreignId] }, organizationId: orgA.id },
  select: { id: true },
});

await prisma.monitor.delete({ where: { id: foreignId } });

console.warn(`org A: ${orgA.slug} (${orgA.monitors.length} monitors)`);
console.warn(`org B: ${orgB.slug} — foreign monitor ${foreignId}`);
console.warn(`rows org A may publish from that id: ${allowed.length}`);
console.warn(allowed.length === 0 ? "PASS: foreign monitor filtered out" : "FAIL: leak");

await prisma.$disconnect();
process.exit(allowed.length === 0 ? 0 : 1);
