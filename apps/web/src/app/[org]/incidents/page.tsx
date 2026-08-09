import { EmptyState, Panel, duration } from "@/components/status";
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
      <div className="row-baseline" style={{ marginBottom: "0.85rem" }}>
        <h1>Incidents</h1>
        <span className="push small dim">
          {incidents.filter((i) => !i.resolvedAt).length} ongoing
        </span>
      </div>

      {incidents.length === 0 ? (
        <Panel>
          <EmptyState title="No incidents recorded" hint="Outages will appear here as they open." />
        </Panel>
      ) : (
        <div className="stack">
          {incidents.map((incident) => (
            <div key={incident.id} className="card card-link">
              <div className="card-pad">
                <div className="row">
                  <span
                    className="badge"
                    style={{
                      color: SEVERITY_COLOR[incident.severity],
                      borderColor: `color-mix(in srgb, ${SEVERITY_COLOR[incident.severity]} 28%, transparent)`,
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
                    <span className="small" style={{ color: "var(--degraded)" }}>
                      flapping
                    </span>
                  )}
                  <span className="push small muted metric">
                    {incident.resolvedAt ? "Resolved" : "Ongoing"} ·{" "}
                    {duration(incident.startedAt, incident.resolvedAt)}
                  </span>
                </div>

                <div className="small dim metric" style={{ marginTop: "0.4rem" }}>
                  Started {incident.startedAt.toISOString().replace("T", " ").slice(0, 19)} UTC
                  {incident.failingRegions.length > 0 &&
                    ` · regions: ${incident.failingRegions.join(", ")}`}
                </div>

                {incident.cause && (
                  <p className="small" style={{ margin: "0.55rem 0 0" }}>
                    {incident.cause}
                  </p>
                )}

                <div style={{ marginTop: "0.7rem" }}>
                  {incident.ackedAt ? (
                    <span className="small dim">
                      Acknowledged by{" "}
                      {incident.ackedBy?.name ?? incident.ackedBy?.email ?? "a team member"}
                    </span>
                  ) : (
                    writable && (
                      <form
                        action={async () => {
                          "use server";
                          await acknowledgeIncident(slug, incident.id);
                        }}
                      >
                        <button type="submit" className="btn btn-sm">
                          Acknowledge
                        </button>
                      </form>
                    )
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
