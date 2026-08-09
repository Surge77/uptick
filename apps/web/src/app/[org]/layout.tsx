import { signOut } from "@/auth";
import { NavLink } from "@/components/nav-link";
import { requireOrg } from "@/lib/tenancy";
import Link from "next/link";

export default async function OrgLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ org: string }>;
}) {
  const { org: slug } = await params;
  const org = await requireOrg(slug);

  return (
    <div className="shell">
      <header className="header">
        <Link href={`/${org.slug}`} className="brand">
          <span className="brand-mark" />
          Uptick
        </Link>

        <nav className="nav">
          <NavLink href={`/${org.slug}`} label="Monitors" exact />
          <NavLink href={`/${org.slug}/incidents`} label="Incidents" />
          <NavLink href={`/${org.slug}/status-pages`} label="Status pages" />
        </nav>

        <div className="row push">
          <span className="small dim">
            {org.name} · {org.role.toLowerCase()}
          </span>
          <form
            action={async () => {
              "use server";
              await signOut({ redirectTo: "/signin" });
            }}
          >
            <button type="submit" className="btn btn-sm">
              Sign out
            </button>
          </form>
        </div>
      </header>

      <main className="container">{children}</main>
    </div>
  );
}
