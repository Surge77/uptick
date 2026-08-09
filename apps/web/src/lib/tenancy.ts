import { auth } from "@/auth";
import { prisma, type Role } from "@uptick/db";
import { redirect } from "next/navigation";

export interface ActiveOrg {
  userId: string;
  organizationId: string;
  slug: string;
  name: string;
  role: Role;
}

/**
 * The signed-in user, or a redirect to sign-in.
 *
 * Every server component and server action starts here. There is no
 * client-supplied identity anywhere in this app.
 */
export async function requireUser(): Promise<{ id: string }> {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/signin");
  }
  return { id: session.user.id };
}

/**
 * Resolve an org slug to an org the caller is actually a member of.
 *
 * The membership lookup is keyed on (userId, slug) together — a caller who
 * guesses another org's slug gets a 404-equivalent redirect, not that org's
 * data. Callers must pass the returned `organizationId` to every subsequent
 * query rather than any value taken from the request.
 */
export async function requireOrg(slug: string): Promise<ActiveOrg> {
  const user = await requireUser();

  const membership = await prisma.membership.findFirst({
    where: { userId: user.id, organization: { slug } },
    select: {
      role: true,
      organization: { select: { id: true, slug: true, name: true } },
    },
  });

  if (!membership) {
    redirect("/");
  }

  return {
    userId: user.id,
    organizationId: membership.organization.id,
    slug: membership.organization.slug,
    name: membership.organization.name,
    role: membership.role,
  };
}

/** Orgs the caller belongs to, for the org switcher and the post-login landing. */
export async function listUserOrgs(userId: string) {
  const memberships = await prisma.membership.findMany({
    where: { userId },
    select: {
      role: true,
      organization: { select: { id: true, slug: true, name: true } },
    },
    orderBy: { organization: { name: "asc" } },
  });

  return memberships.map((m) => ({
    id: m.organization.id,
    slug: m.organization.slug,
    name: m.organization.name,
    role: m.role,
  }));
}

export { canWrite } from "./roles";
