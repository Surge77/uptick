import { listUserOrgs, requireUser } from "@/lib/tenancy";
import { redirect } from "next/navigation";

/**
 * Post-login landing. Sends the caller to their org dashboard rather than
 * rendering anything itself; the org list comes from Membership, so a user
 * with no membership sees the empty state instead of someone else's org.
 */
export default async function HomePage() {
  const user = await requireUser();
  const orgs = await listUserOrgs(user.id);

  const first = orgs[0];
  if (first) {
    redirect(`/${first.slug}`);
  }

  return (
    <main className="center-screen">
      <div style={{ maxWidth: "420px", textAlign: "center" }}>
        <h1>No organization yet</h1>
        <p className="muted" style={{ marginTop: "0.5rem" }}>
          Your account is not a member of any organization. Ask an owner to invite you, or seed one
          locally with <code>pnpm db:seed</code>.
        </p>
      </div>
    </main>
  );
}
