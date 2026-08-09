import { prisma } from "../src/index.js";

const [targets, dependencies, incidents, annotations] = await Promise.all([
  prisma.sloTarget.findMany({
    select: { objective: true, windowDays: true, monitor: { select: { name: true } } },
  }),
  prisma.monitorDependency.findMany({
    select: {
      monitor: { select: { name: true } },
      dependsOn: { select: { name: true } },
    },
  }),
  prisma.incident.count(),
  prisma.annotation.count({ where: { kind: "DEPLOY" } }),
]);

console.warn("slo targets:", targets);
console.warn("dependencies:", dependencies);
console.warn("incidents:", incidents);
console.warn("deploy annotations:", annotations);

await prisma.$disconnect();
