import { BudgetMeter } from "@/components/budget-meter";
import { EditIcon, MonitorTypeIcon, PauseIcon, PlayIcon } from "@/components/icons";
import { LatencyChart } from "@/components/latency-chart";
import { Panel, StateBadge, relativeTime } from "@/components/status";
import { ratioUptime } from "@/lib/chart";
import { setMonitorActive } from "@/lib/monitor-actions";
import { getMonitor, getMonitorBudget, getMonitorRollups } from "@/lib/queries";
import { canWrite, requireOrg } from "@/lib/tenancy";
import Link from "next/link";
import { notFound } from "next/navigation";

function Tile({ name, value, tone }: { name: string; value: string; tone?: string }) {
  return (
    <div className="tile">
      <div className="label" style={{ marginBottom: 0 }}>
        {name}
      </div>
      <div className="tile-value metric" style={tone ? { color: tone } : undefined}>
        {value}
      </div>
    </div>
  );
}

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

/** Ratio-based availability for the glance tiles; contractual uptime is the budget. */
function pct(value: number | null): string {
  return value === null ? "—" : `${value.toFixed(2)}%`;
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

  const points = rollups.map((r) => ({
    day: r.day.toISOString().slice(0, 10),
    p50: r.p50Ms,
    p95: r.p95Ms,
  }));

  return (
    <>
      <div className="page-head">
        <span className="type-chip" style={{ width: 30, height: 30 }}>
          <MonitorTypeIcon type={monitor.type} size={16} />
        </span>
        <h1>{monitor.name}</h1>
        <StateBadge state={monitor.state} />
        {writable && (
          <>
            <Link href={`/${org.slug}/monitors/${id}/edit`} className="btn btn-sm push">
              <EditIcon size={13} />
              Edit
            </Link>
            <form
              action={async () => {
                "use server";
                await setMonitorActive(slug, id, !monitor.active);
              }}
            >
              <button type="submit" className="btn btn-sm">
                {monitor.active ? <PauseIcon size={13} /> : <PlayIcon size={13} />}
                {monitor.active ? "Pause" : "Resume"}
              </button>
            </form>
          </>
        )}
      </div>

      <div className="tiles" style={{ marginBottom: "0.6rem" }}>
        <Tile name="Uptime 24h" value={pct(ratioUptime(rollups, 1))} tone="var(--up)" />
        <Tile name="Uptime 7d" value={pct(ratioUptime(rollups, 7))} />
        <Tile name="Uptime 30d" value={pct(ratioUptime(rollups, 30))} />
        <Tile
          name="p95 latest"
          value={rollups.at(-1)?.p95Ms === undefined ? "—" : `${rollups.at(-1)?.p95Ms} ms`}
        />
      </div>

      <div className="section-label">Response time</div>
      <Panel>
        <LatencyChart points={points} />
      </Panel>

      {budget && (
        <>
          <div className="section-label">Error budget</div>
          <Panel>
            <BudgetMeter budget={budget} />
          </Panel>
        </>
      )}

      <div className="section-label">Configuration</div>
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

      <div className="section-label">Target</div>
      <Panel>
        <code style={{ display: "block", padding: "0.85rem 1.15rem", overflowWrap: "anywhere" }}>
          <span className="dim">{monitor.method}</span> {monitor.target}
        </code>
      </Panel>
    </>
  );
}
