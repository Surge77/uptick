import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@uptick/db";
import NextAuth from "next-auth";
import GitHub from "next-auth/providers/github";

/**
 * Auth.js v5 configuration.
 *
 * Sessions are stored in the database rather than a JWT so that revoking a
 * session takes effect immediately — an on-call engineer removed from an org
 * must lose dashboard access without waiting for a token to expire.
 *
 * `GitHub` reads AUTH_GITHUB_ID / AUTH_GITHUB_SECRET from the environment by
 * convention; they are never referenced directly here.
 */
export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  session: { strategy: "database" },
  providers: [GitHub],
  pages: {
    signIn: "/signin",
  },
  callbacks: {
    session({ session, user }) {
      session.user.id = user.id;
      return session;
    },
  },
});
