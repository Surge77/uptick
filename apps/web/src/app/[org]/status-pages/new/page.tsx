import { EMPTY_STATUS_PAGE, StatusPageForm } from "@/components/status-page-form";
import { createStatusPageForm } from "@/lib/status-page-actions";
import { canWrite, requireOrg } from "@/lib/tenancy";
import { redirect } from "next/navigation";

export default async function NewStatusPagePage({ params }: { params: Promise<{ org: string }> }) {
  const { org: slug } = await params;
  const org = await requireOrg(slug);

  if (!canWrite(org.role)) {
    redirect(`/${slug}/status-pages`);
  }

  return (
    <>
      <h1 style={{ fontSize: "1.15rem", marginTop: 0, marginBottom: "1.25rem" }}>
        New status page
      </h1>
      <StatusPageForm
        action={createStatusPageForm.bind(null, slug)}
        defaults={EMPTY_STATUS_PAGE}
        submitLabel="Create status page"
      />
    </>
  );
}
