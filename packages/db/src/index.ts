import { PrismaClient } from "../generated/client/index.js";

export * from "../generated/client/index.js";

/**
 * Process-wide Prisma client.
 *
 * Cached on `globalThis` so Next.js dev-mode hot reloads and the worker's
 * module graph do not each open a fresh connection pool — Neon's connection
 * limit is reached quickly otherwise.
 */
const globalForPrisma = globalThis as unknown as { uptickPrisma?: PrismaClient };

export const prisma: PrismaClient =
  globalForPrisma.uptickPrisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.uptickPrisma = prisma;
}
