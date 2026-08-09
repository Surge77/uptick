import { Panel, StateBadge, relativeTime } from "@/components/status";
import { UPTIME_WINDOW_DAYS, listMonitors } from "@/lib/queries";
import { canWrite, requireOrg } from "@/lib/tenancy";
import { formatUptime } from "@uptick/core";
import Link from "next/link";

const cell: React.CSSProperties = {
  padding: "0.7rem 1rem",
  borderTop: "1px solid var(--border)",
  fontSize: "0.9rem",
};

const head: React.CSSProperties = {
  padding: "0.6rem 1rem",
  textAlign: "left",
  color: "var(--muted)",
  fontSize: "0.75rem",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
  fontWeight: 600,
};

export default async function MonitorsPage({ params }: { params: Promise<{ org: string }> }) {
  const { org: slug } = await params;
  const org = await requireOrg(slug);
  const monitors = await listMonitors(org.organizationId);

  return (
    <>
      <div style={{ display: "flex", alignItems: "baseline", marginBottom: "1rem" }}>
        <h1 style={{ fontSize: "1.15rem", margin: 0 }}>Monitors</h1>
        <span style={{ marginLeft: "auto", color: "var(--muted)", fontSize: "0.8rem" }}>
          Uptime over {UPTIME_WINDOW_DAYS} days
        </span>
        {canWrite(org.role) && (
          <Link
            href={`/${org.slug}/monitors/new`}
            style={{
              marginLeft: "1rem",
              padding: "0.35rem 0.8rem",
              border: "1px solid var(--border)",
              borderRadius: "6px",
              fontSize: "0.8rem",
            }}
          >
            New monitor
          </Link>
        )}
      </div>

      {monitors.length === 0 ? (
        <Panel>
          <p style={{ padding: "2rem", textAlign: "center", color: "var(--muted)" }}>
            No monitors yet.
          </p>
        </Panel>
      ) : (
        <Panel>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={head}>Monitor</th>
                <th style={head}>State</th>
                <th style={head}>Uptime</th>
                <th style={head}>p95</th>
                <th style={head}>Last check</th>
              </tr>
            </thead>
            <tbody>
              {monitors.map((m) => (
                <tr key={m.id}>
                  <td style={cell}>
                    <Link href={`/${org.slug}/monitors/${m.id}`} style={{ fontWeight: 600 }}>
                      {m.name}
                    </Link>
                    <div
                      style={{
                        color: "var(--muted)",
                        fontSize: "0.78rem",
                        maxWidth: "44ch",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {m.type} · {m.target}
                    </div>
                  </td>
                  <td style={cell}>
                    <StateBadge state={m.state} />
                  </td>
                  <td style={cell}>{formatUptime(m.uptimePercent)}%</td>
                  <td style={cell}>{m.p95Ms === null ? "—" : `${m.p95Ms} ms`}</td>
                  <td style={{ ...cell, color: "var(--muted)" }}>{relativeTime(m.lastCheckAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}
    </>
  );
}
