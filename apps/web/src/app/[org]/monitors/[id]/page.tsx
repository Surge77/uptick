import { Panel, StateBadge, relativeTime } from "@/components/status";
import { setMonitorActive } from "@/lib/monitor-actions";
import { getMonitor, getMonitorRollups } from "@/lib/queries";
import { canWrite, requireOrg } from "@/lib/tenancy";
import Link from "next/link";
import { notFound } from "next/navigation";

const label: React.CSSProperties = {
  color: "var(--muted)",
  fontSize: "0.72rem",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
};

function Stat({ name, value }: { name: string; value: string }) {
  return (
    <div style={{ padding: "0.85rem 1rem" }}>
      <div style={label}>{name}</div>
      <div style={{ fontSize: "0.95rem", marginTop: "0.2rem" }}>{value}</div>
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

  const rollups = await getMonitorRollups(org.organizationId, id);
  const writable = canWrite(org.role);

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: "0.8rem", marginBottom: "1rem" }}>
        <h1 style={{ fontSize: "1.15rem", margin: 0 }}>{monitor.name}</h1>
        <StateBadge state={monitor.state} />
        {writable && (
          <Link
            href={`/${org.slug}/monitors/${id}/edit`}
            style={{
              marginLeft: "auto",
              border: "1px solid var(--border)",
              borderRadius: "6px",
              padding: "0.35rem 0.8rem",
              fontSize: "0.8rem",
            }}
          >
            Edit
          </Link>
        )}
        {writable && (
          <form
            action={async () => {
              "use server";
              await setMonitorActive(slug, id, !monitor.active);
            }}
          >
            <button
              type="submit"
              style={{
                background: "transparent",
                border: "1px solid var(--border)",
                color: "var(--text)",
                borderRadius: "6px",
                padding: "0.35rem 0.8rem",
                fontSize: "0.8rem",
                cursor: "pointer",
              }}
            >
              {monitor.active ? "Pause" : "Resume"}
            </button>
          </form>
        )}
      </div>

      <Panel>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
            gap: "1px",
            background: "var(--border)",
          }}
        >
          <div style={{ background: "var(--panel)" }}>
            <Stat name="Type" value={monitor.type} />
          </div>
          <div style={{ background: "var(--panel)" }}>
            <Stat name="Interval" value={`${monitor.intervalSec}s`} />
          </div>
          <div style={{ background: "var(--panel)" }}>
            <Stat name="Timeout" value={`${monitor.timeoutMs} ms`} />
          </div>
          <div style={{ background: "var(--panel)" }}>
            <Stat name="Degraded above" value={`${monitor.degradedMs} ms`} />
          </div>
          <div style={{ background: "var(--panel)" }}>
            <Stat name="Quorum" value={`${monitor.quorum} regions`} />
          </div>
          <div style={{ background: "var(--panel)" }}>
            <Stat name="Last check" value={relativeTime(monitor.lastCheckAt)} />
          </div>
        </div>
      </Panel>

      <div style={{ ...label, margin: "1.5rem 0 0.5rem" }}>Target</div>
      <Panel>
        <code
          style={{
            display: "block",
            padding: "0.8rem 1rem",
            fontSize: "0.85rem",
            overflowWrap: "anywhere",
          }}
        >
          {monitor.method} {monitor.target}
        </code>
      </Panel>

      <div style={{ ...label, margin: "1.5rem 0 0.5rem" }}>Daily rollups</div>
      <Panel>
        {rollups.length === 0 ? (
          <p style={{ padding: "1.5rem", textAlign: "center", color: "var(--muted)" }}>
            No rollups yet. They are written once a day has completed.
          </p>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
            <thead>
              <tr>
                <th style={{ ...label, padding: "0.6rem 1rem", textAlign: "left" }}>Day</th>
                <th style={{ ...label, padding: "0.6rem 1rem", textAlign: "left" }}>Checks</th>
                <th style={{ ...label, padding: "0.6rem 1rem", textAlign: "left" }}>p50</th>
                <th style={{ ...label, padding: "0.6rem 1rem", textAlign: "left" }}>p95</th>
              </tr>
            </thead>
            <tbody>
              {rollups.map((r) => (
                <tr key={r.day.toISOString()}>
                  <td style={{ padding: "0.5rem 1rem", borderTop: "1px solid var(--border)" }}>
                    {r.day.toISOString().slice(0, 10)}
                  </td>
                  <td style={{ padding: "0.5rem 1rem", borderTop: "1px solid var(--border)" }}>
                    {r.upCount}/{r.totalCount}
                  </td>
                  <td style={{ padding: "0.5rem 1rem", borderTop: "1px solid var(--border)" }}>
                    {r.p50Ms === null ? "—" : `${r.p50Ms} ms`}
                  </td>
                  <td style={{ padding: "0.5rem 1rem", borderTop: "1px solid var(--border)" }}>
                    {r.p95Ms === null ? "—" : `${r.p95Ms} ms`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </>
  );
}
