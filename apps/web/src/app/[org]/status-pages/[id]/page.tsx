import { ComponentPicker } from "@/components/component-picker";
import { Panel } from "@/components/status";
import { StatusPageForm } from "@/components/status-page-form";
import { setStatusPageItemsForm, updateStatusPageForm } from "@/lib/status-page-actions";
import { canWrite, requireOrg } from "@/lib/tenancy";
import { prisma } from "@uptick/db";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

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
      <div className="row-baseline" style={{ marginBottom: "1.4rem" }}>
        <h1>{page.title}</h1>
        <Link
          href={`/status/${page.slug}`}
          className="push small"
          style={{ color: "var(--accent)" }}
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

      <div className="section-label">Published components</div>
      <Panel>
        <div className="card-pad">
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
