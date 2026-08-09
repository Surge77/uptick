import { EmptyState, Panel, StateBadge, duration } from "@/components/status";
import { UptimeBar } from "@/components/uptime-bar";
import { STATUS_WINDOW_DAYS, getPublicStatus } from "@/lib/status-page";
import { aggregateUptime } from "@/lib/chart";
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
  return { title: status ? status.title : "Status" };
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
    <main className="container-narrow">
      <h1>{status.title}</h1>
      {status.description && (
        <p className="muted" style={{ marginTop: "0.3rem" }}>
          {status.description}
        </p>
      )}

      <div className="hero" data-state={status.overall} style={{ margin: "1.5rem 0 2rem" }}>
        <div className="row">
          <div>
            <div className="hero-title">{HEADLINE[status.overall]}</div>
            <div className="small muted" style={{ marginTop: "0.2rem" }}>
              Updated {new Date().toISOString().replace("T", " ").slice(0, 16)} UTC
            </div>
          </div>
          <span className="push">
            <StateBadge state={status.overall} />
          </span>
        </div>
      </div>

      {status.items.length > 0 && (
        <div className="tiles" style={{ marginBottom: "1.1rem" }}>
          {[
            ["Last 24 hours", 1],
            ["Last 7 days", 7],
            ["Last 30 days", 30],
            [`Last ${STATUS_WINDOW_DAYS} days`, STATUS_WINDOW_DAYS],
          ].map(([label, window]) => {
            const value = aggregateUptime(
              status.items.map((i) => i.days),
              window as number,
            );
            return (
              <div className="tile" key={label as string}>
                <div className="label" style={{ marginBottom: 0 }}>
                  {label as string}
                </div>
                <div className="tile-value metric">
                  {value === null ? "—" : `${value.toFixed(3)}%`}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Panel>
        {status.items.length === 0 ? (
          <EmptyState title="No components published" />
        ) : (
          status.items.map((item) => (
            <div key={item.id} className="list-row">
              <div className="row-baseline" style={{ marginBottom: "0.6rem" }}>
                <span style={{ fontWeight: 600 }}>{item.name}</span>
                {item.group && <span className="small dim">{item.group}</span>}
                <span className="push small metric muted">{formatUptime(item.uptimePercent)}</span>
              </div>
              <UptimeBar days={item.days} window={STATUS_WINDOW_DAYS} />
            </div>
          ))
        )}
      </Panel>

      <div className="small dim" style={{ marginTop: "0.6rem", textAlign: "right" }}>
        Last {STATUS_WINDOW_DAYS} days
      </div>

      <h2 className="section-label">Recent incidents</h2>
      {status.incidents.length === 0 ? (
        <Panel>
          <EmptyState
            title="No incidents"
            hint={`Nothing reported in the last ${STATUS_WINDOW_DAYS} days.`}
          />
        </Panel>
      ) : (
        <div className="stack">
          {status.incidents.map((incident) => (
            <div key={incident.id} className="card">
              <div className="card-pad">
                <div className="row">
                  <strong>{incident.monitorName}</strong>
                  <span
                    className="small"
                    style={{
                      color: incident.severity === "DOWN" ? "var(--down)" : "var(--degraded)",
                      fontWeight: 650,
                    }}
                  >
                    {incident.severity}
                  </span>
                  <span className="push small muted metric">
                    {incident.resolvedAt ? "Resolved" : "Ongoing"} ·{" "}
                    {duration(incident.startedAt, incident.resolvedAt)}
                  </span>
                </div>

                {incident.updates.length === 0 ? (
                  <p className="small dim" style={{ margin: "0.55rem 0 0" }}>
                    No updates posted.
                  </p>
                ) : (
                  <ul style={{ listStyle: "none", padding: 0, margin: "0.85rem 0 0" }}>
                    {incident.updates.map((update) => (
                      <li key={update.id} style={{ marginBottom: "0.7rem" }}>
                        <div className="small dim metric">
                          {update.status} ·{" "}
                          {update.createdAt.toISOString().replace("T", " ").slice(0, 16)} UTC
                        </div>
                        <div className="small">{update.body}</div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <footer className="small dim" style={{ marginTop: "3rem", textAlign: "center" }}>
        Powered by Uptick
      </footer>
    </main>
  );
}
