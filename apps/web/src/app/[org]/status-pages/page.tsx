import { EmptyState, Panel } from "@/components/status";
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
      <div className="row-baseline" style={{ marginBottom: "0.85rem" }}>
        <h1>Status pages</h1>
        {canWrite(org.role) && (
          <Link href={`/${org.slug}/status-pages/new`} className="btn btn-sm push">
            New status page
          </Link>
        )}
      </div>

      <Panel>
        {pages.length === 0 ? (
          <EmptyState
            title="No status pages yet"
            hint="Publish a subset of your monitors to a public URL."
          />
        ) : (
          pages.map((page) => (
            <div key={page.id} className="list-row">
              <div className="row">
                <Link href={`/${org.slug}/status-pages/${page.id}`} style={{ fontWeight: 600 }}>
                  {page.title}
                </Link>
                <span className="small dim">
                  /status/{page.slug} · {page._count.items} component
                  {page._count.items === 1 ? "" : "s"}
                </span>
                <span
                  className="push small"
                  style={{ color: page.isPublic ? "var(--up)" : "var(--text-dim)" }}
                >
                  {page.isPublic ? "Public" : "Private"}
                </span>
              </div>
            </div>
          ))
        )}
      </Panel>
    </>
  );
}
