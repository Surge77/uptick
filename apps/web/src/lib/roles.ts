import type { Role } from "@uptick/db";

const WRITE_ROLES: readonly Role[] = ["OWNER", "ADMIN"];

/**
 * MEMBER is read-only: they can see monitors and incidents but not change them.
 *
 * Kept free of auth and Next imports so the rule can be tested directly —
 * authorization logic that is awkward to test tends to go untested.
 */
export function canWrite(role: Role): boolean {
  return WRITE_ROLES.includes(role);
}
