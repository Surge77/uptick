import { Panel, StateBadge, duration } from "@/components/status";
import { UptimeBar } from "@/components/uptime-bar";
import { STATUS_WINDOW_DAYS, getPublicStatus } from "@/lib/status-page";
import { formatUptime } from "@uptick/core";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const status = await getPublicStatus(slug);
  return { title: status ? `${status.title} status` : "Status" };
}

const HEADLINE: Record<string, string> = {
  UP: "All systems operational",
  DEGRADED: "Degraded performance",
  DOWN: "Major outage",
  PENDING: "Awaiting data",
  PAUSED: "Monitoring paused",
};

export default async function PublicStatusPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const status = await getPublicStatus(slug);

  if (!status) {
    notFound();
  }

  return (
    <main style={{ maxWidth: "820px", margin: "0 auto", padding: "2.5rem 1.5rem" }}>
      <h1 style={{ fontSize: "1.4rem", marginBottom: "0.25rem" }}>{status.title}</h1>
      {status.description && (
        <p style={{ color: "var(--muted)", marginTop: 0 }}>{status.description}</p>
      )}

      <div style={{ margin: "1.5rem 0" }}>
        <Panel>
          <div style={{ padding: "1rem 1.25rem", display: "flex", alignItems: "center" }}>
            <strong style={{ fontSize: "1rem" }}>{HEADLINE[status.overall]}</strong>
            <span style={{ marginLeft: "auto" }}>
              <StateBadge state={status.overall} />
            </span>
          </div>
        </Panel>
      </div>

      <Panel>
        {status.items.length === 0 ? (
          <p style={{ padding: "2rem", textAlign: "center", color: "var(--muted)" }}>
            No components published.
          </p>
        ) : (
          status.items.map((item, index) => (
            <div
              key={item.id}
              style={{
                padding: "1rem 1.25rem",
                borderTop: index === 0 ? "none" : "1px solid var(--border)",
              }}
            >
              <div style={{ display: "flex", alignItems: "baseline", marginBottom: "0.5rem" }}>
                <span style={{ fontWeight: 600 }}>{item.name}</span>
                {item.group && (
                  <span
                    style={{ color: "var(--muted)", fontSize: "0.78rem", marginLeft: "0.5rem" }}
                  >
                    {item.group}
                  </span>
                )}
                <span style={{ marginLeft: "auto", color: "var(--muted)", fontSize: "0.82rem" }}>
                  {formatUptime(item.uptimePercent)}%
                </span>
              </div>
              <UptimeBar days={item.days} />
            </div>
          ))
        )}
      </Panel>

      <div style={{ color: "var(--muted)", fontSize: "0.75rem", marginTop: "0.5rem" }}>
        Uptime over the last {STATUS_WINDOW_DAYS} days
      </div>

      <h2 style={{ fontSize: "1rem", margin: "2rem 0 0.75rem" }}>Recent incidents</h2>
      {status.incidents.length === 0 ? (
        <Panel>
          <p style={{ padding: "1.5rem", textAlign: "center", color: "var(--muted)" }}>
            No incidents in the last {STATUS_WINDOW_DAYS} days.
          </p>
        </Panel>
      ) : (
        <div style={{ display: "grid", gap: "0.6rem" }}>
          {status.incidents.map((incident) => (
            <Panel key={incident.id}>
              <div style={{ padding: "0.9rem 1.25rem" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
                  <strong style={{ fontSize: "0.9rem" }}>{incident.monitorName}</strong>
                  <span
                    style={{
                      color: incident.severity === "DOWN" ? "var(--down)" : "var(--degraded)",
                      fontSize: "0.72rem",
                      fontWeight: 700,
                    }}
                  >
                    {incident.severity}
                  </span>
                  <span style={{ marginLeft: "auto", color: "var(--muted)", fontSize: "0.78rem" }}>
                    {incident.resolvedAt ? "Resolved" : "Ongoing"} ·{" "}
                    {duration(incident.startedAt, incident.resolvedAt)}
                  </span>
                </div>

                {incident.updates.length === 0 ? (
                  <p style={{ color: "var(--muted)", fontSize: "0.82rem", margin: "0.5rem 0 0" }}>
                    No updates posted.
                  </p>
                ) : (
                  <ul style={{ listStyle: "none", padding: 0, margin: "0.75rem 0 0" }}>
                    {incident.updates.map((update) => (
                      <li key={update.id} style={{ marginBottom: "0.6rem" }}>
                        <div style={{ fontSize: "0.72rem", color: "var(--muted)" }}>
                          {update.status} ·{" "}
                          {update.createdAt.toISOString().replace("T", " ").slice(0, 16)} UTC
                        </div>
                        <div style={{ fontSize: "0.85rem" }}>{update.body}</div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </Panel>
          ))}
        </div>
      )}
    </main>
  );
}
