import { EMPTY_MONITOR, MonitorForm } from "@/components/monitor-form";
import { createMonitorForm } from "@/lib/monitor-actions";
import { canWrite, requireOrg } from "@/lib/tenancy";
import { redirect } from "next/navigation";

export default async function NewMonitorPage({ params }: { params: Promise<{ org: string }> }) {
  const { org: slug } = await params;
  const org = await requireOrg(slug);

  // Read-only members never reach the form, not merely the submit handler.
  if (!canWrite(org.role)) {
    redirect(`/${slug}`);
  }

  return (
    <>
      <h1 style={{ fontSize: "1.15rem", marginTop: 0, marginBottom: "1.25rem" }}>New monitor</h1>
      <MonitorForm
        action={createMonitorForm.bind(null, slug)}
        defaults={EMPTY_MONITOR}
        submitLabel="Create monitor"
      />
    </>
  );
}
