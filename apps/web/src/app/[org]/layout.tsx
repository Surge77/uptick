import { signOut } from "@/auth";
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
    <div style={{ minHeight: "100vh" }}>
      <header
        style={{
          borderBottom: "1px solid var(--border)",
          padding: "0.75rem 1.5rem",
          display: "flex",
          alignItems: "center",
          gap: "1.5rem",
        }}
      >
        <Link href={`/${org.slug}`} style={{ fontWeight: 700 }}>
          Uptick
        </Link>
        <nav style={{ display: "flex", gap: "1rem", color: "var(--muted)", fontSize: "0.9rem" }}>
          <Link href={`/${org.slug}`}>Monitors</Link>
          <Link href={`/${org.slug}/incidents`}>Incidents</Link>
        </nav>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "1rem" }}>
          <span style={{ color: "var(--muted)", fontSize: "0.85rem" }}>
            {org.name} · {org.role}
          </span>
          <form
            action={async () => {
              "use server";
              await signOut({ redirectTo: "/signin" });
            }}
          >
            <button
              type="submit"
              style={{
                background: "transparent",
                border: "1px solid var(--border)",
                color: "var(--muted)",
                borderRadius: "6px",
                padding: "0.3rem 0.7rem",
                fontSize: "0.8rem",
                cursor: "pointer",
              }}
            >
              Sign out
            </button>
          </form>
        </div>
      </header>
      <main style={{ padding: "1.5rem", maxWidth: "1100px", margin: "0 auto" }}>{children}</main>
    </div>
  );
}
