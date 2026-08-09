import { EmptyState, Panel, StateBadge, relativeTime } from "@/components/status";
import { UPTIME_WINDOW_DAYS, listMonitors, type MonitorSummary } from "@/lib/queries";
import { worstState } from "@/lib/status-severity";
import { canWrite, requireOrg } from "@/lib/tenancy";
import { formatUptime } from "@uptick/core";
import Link from "next/link";

const HEADLINE: Record<string, string> = {
  UP: "All systems operational",
  DEGRADED: "Degraded performance",
  DOWN: "Active outage",
  PENDING: "Awaiting first results",
  PAUSED: "Monitoring paused",
};

function Summary({ monitors }: { monitors: MonitorSummary[] }) {
  const overall = worstState(monitors.map((m) => m.state));
  const down = monitors.filter((m) => m.state === "DOWN").length;
  const degraded = monitors.filter((m) => m.state === "DEGRADED").length;

  return (
    <div className="hero" data-state={overall} style={{ marginBottom: "1.5rem" }}>
      <div className="row">
        <div>
          <div className="hero-title">{HEADLINE[overall]}</div>
          <div className="small muted" style={{ marginTop: "0.2rem" }}>
            {monitors.length} monitor{monitors.length === 1 ? "" : "s"}
            {down > 0 && ` · ${down} down`}
            {degraded > 0 && ` · ${degraded} degraded`}
          </div>
        </div>
        <span className="push">
          <StateBadge state={overall} />
        </span>
      </div>
    </div>
  );
}

export default async function MonitorsPage({ params }: { params: Promise<{ org: string }> }) {
  const { org: slug } = await params;
  const org = await requireOrg(slug);
  const monitors = await listMonitors(org.organizationId);

  return (
    <>
      {monitors.length > 0 && <Summary monitors={monitors} />}

      <div className="row-baseline" style={{ marginBottom: "0.85rem" }}>
        <h1>Monitors</h1>
        <span className="push small dim">Uptime over {UPTIME_WINDOW_DAYS} days</span>
        {canWrite(org.role) && (
          <Link href={`/${org.slug}/monitors/new`} className="btn btn-sm">
            New monitor
          </Link>
        )}
      </div>

      <Panel>
        {monitors.length === 0 ? (
          <EmptyState title="No monitors yet" hint="Create one to start recording availability." />
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Monitor</th>
                <th>State</th>
                <th>Uptime</th>
                <th>p95</th>
                <th>Last check</th>
              </tr>
            </thead>
            <tbody>
              {monitors.map((m) => (
                <tr key={m.id}>
                  <td>
                    <Link href={`/${org.slug}/monitors/${m.id}`} style={{ fontWeight: 600 }}>
                      {m.name}
                    </Link>
                    <div className="small dim truncate">
                      {m.type} · {m.target}
                    </div>
                  </td>
                  <td>
                    <StateBadge state={m.state} />
                  </td>
                  <td className="metric">{formatUptime(m.uptimePercent)}</td>
                  <td className="metric">{m.p95Ms === null ? "—" : `${m.p95Ms} ms`}</td>
                  <td className="muted">{relativeTime(m.lastCheckAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </>
  );
}
