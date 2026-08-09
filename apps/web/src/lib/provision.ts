import { prisma } from "@uptick/db";

const MAX_SLUG_ATTEMPTS = 50;

/** Slugify a display name or email local-part into a URL-safe org slug. */
export function slugifyOrgName(source: string): string {
  const base = source
    .toLowerCase()
    .replace(/@.*$/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
  return base === "" ? "org" : base;
}

/**
 * Give a brand-new user an organization they own.
 *
 * Without this, the first sign-in produces a User with no Membership, and
 * every tenancy lookup correctly finds nothing — the account lands on the
 * empty state and can never do anything. Running it from the `createUser`
 * event keeps org creation tied to account creation rather than to a manual
 * step someone has to remember.
 */
export async function provisionPersonalOrg(
  userId: string,
  name?: string | null,
  email?: string | null,
) {
  const label = name?.trim() || email?.split("@")[0] || "My";
  const slug = await uniqueSlug(slugifyOrgName(label));

  await prisma.organization.create({
    data: {
      name: `${label}'s workspace`,
      slug,
      memberships: { create: { userId, role: "OWNER" } },
    },
  });
}

/** Append a numeric suffix until the slug is free; `slug` is globally unique. */
async function uniqueSlug(base: string): Promise<string> {
  for (let attempt = 0; attempt < MAX_SLUG_ATTEMPTS; attempt += 1) {
    const candidate = attempt === 0 ? base : `${base}-${attempt + 1}`;
    const taken = await prisma.organization.findUnique({
      where: { slug: candidate },
      select: { id: true },
    });
    if (!taken) {
      return candidate;
    }
  }
  // Collision-resistant fallback rather than looping forever.
  return `${base}-${Date.now().toString(36)}`;
}
