import { BudgetMeter } from "@/components/budget-meter";
import { EmptyState, Panel, StateBadge, relativeTime } from "@/components/status";
import { setMonitorActive } from "@/lib/monitor-actions";
import { getMonitor, getMonitorBudget, getMonitorRollups } from "@/lib/queries";
import { canWrite, requireOrg } from "@/lib/tenancy";
import Link from "next/link";
import { notFound } from "next/navigation";

function Stat({ name, value }: { name: string; value: string }) {
  return (
    <div className="stat">
      <div className="label" style={{ marginBottom: 0 }}>
        {name}
      </div>
      <div className="stat-value metric">{value}</div>
    </div>
  );
}

export default async function MonitorDetailPage({
  params,
}: {
  params: Promise<{ org: string; id: string }>;
}) {
  const { org: slug, id } = await params;
  const org = await requireOrg(slug);

  const monitor = await getMonitor(org.organizationId, id);
  if (!monitor) {
    notFound();
  }

  const [rollups, budget] = await Promise.all([
    getMonitorRollups(org.organizationId, id),
    getMonitorBudget(org.organizationId, id),
  ]);
  const writable = canWrite(org.role);

  return (
    <>
      <div className="row" style={{ marginBottom: "1.25rem" }}>
        <h1>{monitor.name}</h1>
        <StateBadge state={monitor.state} />
        {writable && (
          <>
            <Link href={`/${org.slug}/monitors/${id}/edit`} className="btn btn-sm push">
              Edit
            </Link>
            <form
              action={async () => {
                "use server";
                await setMonitorActive(slug, id, !monitor.active);
              }}
            >
              <button type="submit" className="btn btn-sm">
                {monitor.active ? "Pause" : "Resume"}
              </button>
            </form>
          </>
        )}
      </div>

      <Panel>
        <div className="stats">
          <Stat name="Type" value={monitor.type} />
          <Stat name="Interval" value={`${monitor.intervalSec}s`} />
          <Stat name="Timeout" value={`${monitor.timeoutMs} ms`} />
          <Stat name="Degraded above" value={`${monitor.degradedMs} ms`} />
          <Stat name="Quorum" value={`${monitor.quorum} regions`} />
          <Stat name="Last check" value={relativeTime(monitor.lastCheckAt)} />
        </div>
      </Panel>

      {budget && (
        <>
          <div className="section-label">Error budget</div>
          <Panel>
            <BudgetMeter budget={budget} />
          </Panel>
        </>
      )}

      <div className="section-label">Target</div>
      <Panel>
        <code style={{ display: "block", padding: "0.8rem 1.15rem", overflowWrap: "anywhere" }}>
          <span className="dim">{monitor.method}</span> {monitor.target}
        </code>
      </Panel>

      <div className="section-label">Daily rollups</div>
      <Panel>
        {rollups.length === 0 ? (
          <EmptyState
            title="No rollups yet"
            hint="Written once a full day of checks has completed."
          />
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Day</th>
                <th>Checks</th>
                <th>p50</th>
                <th>p95</th>
              </tr>
            </thead>
            <tbody>
              {rollups.map((r) => (
                <tr key={r.day.toISOString()}>
                  <td>{r.day.toISOString().slice(0, 10)}</td>
                  <td>
                    {r.upCount}/{r.totalCount}
                  </td>
                  <td>{r.p50Ms === null ? "—" : `${r.p50Ms} ms`}</td>
                  <td>{r.p95Ms === null ? "—" : `${r.p95Ms} ms`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </>
  );
}
