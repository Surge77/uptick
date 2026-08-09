import { signOut } from "@/auth";
import { AlertIcon, GlobeIcon, PulseIcon, SignOutIcon } from "@/components/icons";
import { Wordmark } from "@/components/logo";
import { SideLink } from "@/components/side-link";
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
  const initials = org.name.slice(0, 2).toUpperCase();

  return (
    <div className="app">
      <aside className="sidebar">
        <Link href={`/${org.slug}`}>
          <Wordmark />
        </Link>

        <SideLink href={`/${org.slug}`} label="Monitors" icon={<PulseIcon size={15} />} exact />
        <SideLink
          href={`/${org.slug}/incidents`}
          label="Incidents"
          icon={<AlertIcon size={15} />}
        />
        <SideLink
          href={`/${org.slug}/status-pages`}
          label="Status pages"
          icon={<GlobeIcon size={15} />}
        />

        <div className="side-foot">
          <div className="org-chip">
            <span className="avatar">{initials}</span>
            <span style={{ minWidth: 0 }}>
              <div className="small truncate" style={{ fontWeight: 560 }}>
                {org.name}
              </div>
              <div className="small dim" style={{ lineHeight: 1.2 }}>
                {org.role.toLowerCase()}
              </div>
            </span>
          </div>

          <form
            action={async () => {
              "use server";
              await signOut({ redirectTo: "/signin" });
            }}
          >
            <button type="submit" className="side-link" style={{ width: "100%" }}>
              <SignOutIcon size={15} />
              Sign out
            </button>
          </form>
        </div>
      </aside>

      <main className="content">{children}</main>
    </div>
  );
}
