import { prisma } from "../src/index.js";

/**
 * Attach an existing user to an existing org as OWNER.
 *
 * For local development only: accounts created before automatic org
 * provisioning existed have no membership and cannot see anything.
 *
 * Usage: tsx scripts/grant-membership.ts <email> <org-slug>
 */
const [email, slug] = process.argv.slice(2);

if (!email || !slug) {
  console.error("Usage: tsx scripts/grant-membership.ts <email> <org-slug>");
  process.exit(1);
}

const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
if (!user) {
  console.error(`No user with email ${email}`);
  process.exit(1);
}

const org = await prisma.organization.findUnique({ where: { slug }, select: { id: true } });
if (!org) {
  console.error(`No organization with slug ${slug}`);
  process.exit(1);
}

await prisma.membership.upsert({
  where: { userId_organizationId: { userId: user.id, organizationId: org.id } },
  create: { userId: user.id, organizationId: org.id, role: "OWNER" },
  update: { role: "OWNER" },
});

console.warn(`Granted ${email} OWNER on ${slug}`);
await prisma.$disconnect();
