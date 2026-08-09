import { randomBytes } from "node:crypto";
import { prisma } from "../src/index.js";

/**
 * Mint a database session for local UI verification.
 *
 * Auth.js stores sessions in the Session table, so a row plus the matching
 * cookie is a real signed-in session — no OAuth round trip needed. Local
 * development only: it bypasses the identity provider entirely, which is
 * exactly why it must never run anywhere a real user could reach.
 *
 * Usage: tsx scripts/dev-session.ts [email]
 */
if (process.env.NODE_ENV === "production") {
  console.error("refusing to mint a session outside development");
  process.exit(1);
}

const email = process.argv[2];

const user = email
  ? await prisma.user.findUnique({ where: { email }, select: { id: true, email: true } })
  : await prisma.user.findFirst({ select: { id: true, email: true } });

if (!user) {
  console.error("no user found; sign in once through GitHub first");
  process.exit(1);
}

const sessionToken = randomBytes(32).toString("hex");

await prisma.session.create({
  data: {
    sessionToken,
    userId: user.id,
    expires: new Date(Date.now() + 60 * 60 * 1000),
  },
});

console.warn(JSON.stringify({ email: user.email, sessionToken }));

await prisma.$disconnect();
