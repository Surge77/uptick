import { prisma } from "../src/index.js";

/**
 * Remove deploy markers created by local webhook testing.
 *
 * Usage: tsx scripts/purge-test-deploys.ts <label-substring>
 */
const label = process.argv[2];

if (!label) {
  console.error("Usage: tsx scripts/purge-test-deploys.ts <label-substring>");
  process.exit(1);
}

const { count } = await prisma.annotation.deleteMany({
  where: { kind: "DEPLOY", label: { contains: label } },
});

console.warn(`removed ${count} deploy annotations matching "${label}"`);

await prisma.$disconnect();
