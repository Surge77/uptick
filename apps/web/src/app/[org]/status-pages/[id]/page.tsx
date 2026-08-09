import { ComponentPicker } from "@/components/component-picker";
import { Panel } from "@/components/status";
import { StatusPageForm } from "@/components/status-page-form";
import { setStatusPageItemsForm, updateStatusPageForm } from "@/lib/status-page-actions";
import { canWrite, requireOrg } from "@/lib/tenancy";
import { prisma } from "@uptick/db";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

const heading: React.CSSProperties = {
  fontSize: "0.72rem",
  color: "var(--muted)",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
  margin: "2rem 0 0.6rem",
};

export default async function EditStatusPagePage({
  params,
}: {
  params: Promise<{ org: string; id: string }>;
}) {
  const { org: slug, id } = await params;
  const org = await requireOrg(slug);

  if (!canWrite(org.role)) {
    redirect(`/${slug}/status-pages`);
  }

  const page = await prisma.statusPage.findFirst({
    where: { id, organizationId: org.organizationId },
    select: {
      id: true,
      title: true,
      slug: true,
      description: true,
      isPublic: true,
      items: { select: { monitorId: true } },
    },
  });

  if (!page) {
    notFound();
  }

  const monitors = await prisma.monitor.findMany({
    where: { organizationId: org.organizationId },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });

  const selected = new Set(page.items.map((item) => item.monitorId));

  return (
    <>
      <div style={{ display: "flex", alignItems: "baseline", marginBottom: "1.25rem" }}>
        <h1 style={{ fontSize: "1.15rem", margin: 0 }}>{page.title}</h1>
        <Link
          href={`/status/${page.slug}`}
          style={{ marginLeft: "auto", color: "var(--accent)", fontSize: "0.82rem" }}
        >
          View public page →
        </Link>
      </div>

      <StatusPageForm
        action={updateStatusPageForm.bind(null, slug, page.id)}
        defaults={{
          title: page.title,
          slug: page.slug,
          description: page.description ?? "",
          isPublic: page.isPublic,
        }}
        submitLabel="Save changes"
      />

      <h2 style={heading}>Published components</h2>
      <Panel>
        <div style={{ padding: "1rem 1.25rem" }}>
          <ComponentPicker
            action={setStatusPageItemsForm.bind(null, slug, page.id)}
            monitors={monitors.map((m) => ({
              id: m.id,
              name: m.name,
              selected: selected.has(m.id),
            }))}
          />
        </div>
      </Panel>
    </>
  );
}
