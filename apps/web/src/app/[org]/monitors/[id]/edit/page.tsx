import { MonitorForm } from "@/components/monitor-form";
import { updateMonitorForm } from "@/lib/monitor-actions";
import { getMonitor } from "@/lib/queries";
import { canWrite, requireOrg } from "@/lib/tenancy";
import { notFound, redirect } from "next/navigation";

export default async function EditMonitorPage({
  params,
}: {
  params: Promise<{ org: string; id: string }>;
}) {
  const { org: slug, id } = await params;
  const org = await requireOrg(slug);

  if (!canWrite(org.role)) {
    redirect(`/${slug}/monitors/${id}`);
  }

  const monitor = await getMonitor(org.organizationId, id);
  if (!monitor) {
    notFound();
  }

  return (
    <>
      <h1 style={{ marginBottom: "1.4rem" }}>Edit {monitor.name}</h1>
      <MonitorForm
        action={updateMonitorForm.bind(null, slug, id)}
        defaults={{
          name: monitor.name,
          type: monitor.type,
          target: monitor.target,
          method: monitor.method,
          intervalSec: monitor.intervalSec,
          timeoutMs: monitor.timeoutMs,
          degradedMs: monitor.degradedMs,
        }}
        submitLabel="Save changes"
      />
    </>
  );
}
