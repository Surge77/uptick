import { Panel } from "@/components/status";
import { canWrite, requireOrg } from "@/lib/tenancy";
import { prisma } from "@uptick/db";
import Link from "next/link";

export default async function StatusPagesPage({ params }: { params: Promise<{ org: string }> }) {
  const { org: slug } = await params;
  const org = await requireOrg(slug);

  const pages = await prisma.statusPage.findMany({
    where: { organizationId: org.organizationId },
    orderBy: { title: "asc" },
    select: {
      id: true,
      title: true,
      slug: true,
      isPublic: true,
      _count: { select: { items: true } },
    },
  });

  return (
    <>
      <div style={{ display: "flex", alignItems: "baseline", marginBottom: "1rem" }}>
        <h1 style={{ fontSize: "1.15rem", margin: 0 }}>Status pages</h1>
        {canWrite(org.role) && (
          <Link
            href={`/${org.slug}/status-pages/new`}
            style={{
              marginLeft: "auto",
              padding: "0.35rem 0.8rem",
              border: "1px solid var(--border)",
              borderRadius: "6px",
              fontSize: "0.8rem",
            }}
          >
            New status page
          </Link>
        )}
      </div>

      <Panel>
        {pages.length === 0 ? (
          <p style={{ padding: "2rem", textAlign: "center", color: "var(--muted)" }}>
            No status pages yet.
          </p>
        ) : (
          pages.map((page, index) => (
            <div
              key={page.id}
              style={{
                padding: "0.85rem 1rem",
                borderTop: index === 0 ? "none" : "1px solid var(--border)",
                display: "flex",
                alignItems: "center",
                gap: "0.75rem",
              }}
            >
              <Link href={`/${org.slug}/status-pages/${page.id}`} style={{ fontWeight: 600 }}>
                {page.title}
              </Link>
              <span style={{ color: "var(--muted)", fontSize: "0.8rem" }}>
                /status/{page.slug} · {page._count.items} components
              </span>
              <span
                style={{
                  marginLeft: "auto",
                  fontSize: "0.75rem",
                  color: page.isPublic ? "var(--up)" : "var(--muted)",
                }}
              >
                {page.isPublic ? "Public" : "Private"}
              </span>
            </div>
          ))
        )}
      </Panel>
    </>
  );
}
