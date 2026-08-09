import { MonitorTypeIcon, PlusIcon } from "@/components/icons";
import { Sparkline } from "@/components/sparkline";
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

/** Sparkline tone follows state, so a bad row reads as bad at a glance. */
function toneFor(state: string): string {
  if (state === "DOWN") return "var(--down)";
  if (state === "DEGRADED") return "var(--degraded)";
  return "var(--brand)";
}

function Overview({ monitors }: { monitors: MonitorSummary[] }) {
  const overall = worstState(monitors.map((m) => m.state));
  const down = monitors.filter((m) => m.state === "DOWN").length;
  const degraded = monitors.filter((m) => m.state === "DEGRADED").length;
  const healthy = monitors.filter((m) => m.state === "UP").length;

  return (
    <div className="hero" data-state={overall} style={{ marginBottom: "1.5rem" }}>
      <div className="row">
        <div>
          <div className="hero-title">{HEADLINE[overall]}</div>
          <div className="small muted" style={{ marginTop: "0.2rem" }}>
            {healthy} healthy
            {degraded > 0 && ` · ${degraded} degraded`}
            {down > 0 && ` · ${down} down`} · {monitors.length} total
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
      {monitors.length > 0 && <Overview monitors={monitors} />}

      <div className="page-head">
        <h1>Monitors</h1>
        <span className="push small dim">Last {UPTIME_WINDOW_DAYS} days</span>
        {canWrite(org.role) && (
          <Link href={`/${org.slug}/monitors/new`} className="btn btn-primary btn-sm">
            <PlusIcon size={14} />
            New monitor
          </Link>
        )}
      </div>

      <Panel>
        {monitors.length === 0 ? (
          <EmptyState title="No monitors yet" hint="Create one to start recording availability." />
        ) : (
          monitors.map((m) => (
            <div key={m.id} className="monitor-row">
              <div style={{ minWidth: 0 }}>
                <div className="monitor-name">
                  <span className="type-chip">
                    <MonitorTypeIcon type={m.type} />
                  </span>
                  <Link href={`/${org.slug}/monitors/${m.id}`}>{m.name}</Link>
                  <StateBadge state={m.state} />
                </div>
                <div className="small dim truncate" style={{ marginLeft: "2.1rem" }}>
                  {m.target}
                </div>
              </div>

              <Sparkline values={m.latency} tone={toneFor(m.state)} />

              <div style={{ textAlign: "right" }}>
                <div className="metric" style={{ fontWeight: 580 }}>
                  {formatUptime(m.uptimePercent, 2)}
                </div>
                <div className="small dim">uptime</div>
              </div>

              <div style={{ textAlign: "right" }}>
                <div className="metric">{m.p95Ms === null ? "—" : `${m.p95Ms} ms`}</div>
                <div className="small dim">{relativeTime(m.lastCheckAt)}</div>
              </div>
            </div>
          ))
        )}
      </Panel>
    </>
  );
}
