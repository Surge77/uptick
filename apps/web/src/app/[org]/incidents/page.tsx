import { Panel, duration } from "@/components/status";
import { acknowledgeIncident } from "@/lib/monitor-actions";
import { listIncidents } from "@/lib/queries";
import { canWrite, requireOrg } from "@/lib/tenancy";
import Link from "next/link";

const SEVERITY_COLOR = { DOWN: "var(--down)", DEGRADED: "var(--degraded)" } as const;

export default async function IncidentsPage({ params }: { params: Promise<{ org: string }> }) {
  const { org: slug } = await params;
  const org = await requireOrg(slug);
  const incidents = await listIncidents(org.organizationId);
  const writable = canWrite(org.role);

  return (
    <>
      <h1 style={{ fontSize: "1.15rem", marginTop: 0, marginBottom: "1rem" }}>Incidents</h1>

      {incidents.length === 0 ? (
        <Panel>
          <p style={{ padding: "2rem", textAlign: "center", color: "var(--muted)" }}>
            No incidents recorded.
          </p>
        </Panel>
      ) : (
        <div style={{ display: "grid", gap: "0.6rem" }}>
          {incidents.map((incident) => (
            <Panel key={incident.id}>
              <div style={{ padding: "0.9rem 1rem" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
                  <span
                    style={{
                      color: SEVERITY_COLOR[incident.severity],
                      fontWeight: 700,
                      fontSize: "0.75rem",
                      letterSpacing: "0.05em",
                    }}
                  >
                    {incident.severity}
                  </span>
                  <Link
                    href={`/${org.slug}/monitors/${incident.monitor.id}`}
                    style={{ fontWeight: 600 }}
                  >
                    {incident.monitor.name}
                  </Link>
                  {incident.isFlapping && (
                    <span style={{ color: "var(--degraded)", fontSize: "0.75rem" }}>flapping</span>
                  )}
                  <span style={{ marginLeft: "auto", color: "var(--muted)", fontSize: "0.8rem" }}>
                    {incident.resolvedAt ? "Resolved" : "Ongoing"} ·{" "}
                    {duration(incident.startedAt, incident.resolvedAt)}
                  </span>
                </div>

                <div style={{ color: "var(--muted)", fontSize: "0.82rem", marginTop: "0.35rem" }}>
                  Started {incident.startedAt.toISOString().replace("T", " ").slice(0, 19)} UTC
                  {incident.failingRegions.length > 0 &&
                    ` · regions: ${incident.failingRegions.join(", ")}`}
                </div>

                {incident.cause && (
                  <p style={{ fontSize: "0.85rem", margin: "0.5rem 0 0" }}>{incident.cause}</p>
                )}

                <div style={{ marginTop: "0.6rem", fontSize: "0.8rem", color: "var(--muted)" }}>
                  {incident.ackedAt ? (
                    <>Acknowledged by {incident.ackedBy?.name ?? incident.ackedBy?.email ?? "—"}</>
                  ) : (
                    writable && (
                      <form
                        action={async () => {
                          "use server";
                          await acknowledgeIncident(slug, incident.id);
                        }}
                      >
                        <button
                          type="submit"
                          style={{
                            background: "transparent",
                            border: "1px solid var(--border)",
                            color: "var(--text)",
                            borderRadius: "6px",
                            padding: "0.3rem 0.7rem",
                            fontSize: "0.78rem",
                            cursor: "pointer",
                          }}
                        >
                          Acknowledge
                        </button>
                      </form>
                    )
                  )}
                </div>
              </div>
            </Panel>
          ))}
        </div>
      )}
    </>
  );
}
