import { prisma } from "../src/index.js";

const users = await prisma.user.findMany({ select: { id: true, email: true, name: true } });
const orgs = await prisma.organization.findMany({ select: { id: true, slug: true, name: true } });
const memberships = await prisma.membership.findMany({
  select: {
    role: true,
    user: { select: { email: true } },
    organization: { select: { slug: true } },
  },
});
const monitors = await prisma.monitor.count();
const deploys = await prisma.annotation.findMany({
  where: { kind: "DEPLOY" },
  select: { label: true, monitorId: true, ts: true },
  orderBy: { ts: "desc" },
  take: 5,
});

console.warn("users:", users);
console.warn("orgs:", orgs);
console.warn("memberships:", memberships);
console.warn("monitors:", monitors);
console.warn("recent deploy annotations:", deploys);

await prisma.$disconnect();
