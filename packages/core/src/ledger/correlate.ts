import { minutes } from "../time.js";

export interface DeployMarker {
  id: string;
  label: string;
  ts: Date;
  /** Null for org-wide deploys that are not tied to one monitor. */
  monitorId: string | null;
}

export interface CorrelatableIncident {
  id: string;
  monitorId: string;
  startedAt: Date;
}

export interface Correlation {
  incidentId: string;
  deployId: string;
  label: string;
  /** How long after the deploy the incident opened, in ms. */
  lagMs: number;
  confidence: "likely" | "possible";
}

/** Deploys further back than this are not plausible causes of an outage. */
export const DEFAULT_CORRELATION_WINDOW_MS = minutes(30);

/** Inside this lag, the association is strong enough to surface by default. */
export const LIKELY_LAG_MS = minutes(5);

/**
 * Attribute an incident to the deploy that most plausibly caused it.
 *
 * Correlation is not causation and this deliberately does not pretend
 * otherwise: it reports the closest preceding deploy inside a bounded window
 * and labels how tight the association is. A deploy two minutes before an
 * outage is worth showing an operator; one twenty-nine minutes before is worth
 * mentioning quietly.
 *
 * A deploy scoped to a specific monitor is preferred over an org-wide marker
 * at the same distance, since it is the more specific explanation.
 */
export function correlateDeploys(
  incidents: readonly CorrelatableIncident[],
  deploys: readonly DeployMarker[],
  windowMs: number = DEFAULT_CORRELATION_WINDOW_MS,
): Correlation[] {
  const correlations: Correlation[] = [];

  for (const incident of incidents) {
    const best = bestDeployFor(incident, deploys, windowMs);
    if (best) {
      const lagMs = incident.startedAt.getTime() - best.ts.getTime();
      correlations.push({
        incidentId: incident.id,
        deployId: best.id,
        label: best.label,
        lagMs,
        confidence: lagMs <= LIKELY_LAG_MS ? "likely" : "possible",
      });
    }
  }

  return correlations;
}

function bestDeployFor(
  incident: CorrelatableIncident,
  deploys: readonly DeployMarker[],
  windowMs: number,
): DeployMarker | null {
  let best: DeployMarker | null = null;
  let bestLag = Number.POSITIVE_INFINITY;

  for (const deploy of deploys) {
    if (deploy.monitorId !== null && deploy.monitorId !== incident.monitorId) {
      continue;
    }

    const lag = incident.startedAt.getTime() - deploy.ts.getTime();
    // A deploy after the outage began cannot have caused it.
    if (lag < 0 || lag > windowMs) {
      continue;
    }

    if (lag < bestLag || (lag === bestLag && isMoreSpecific(deploy, best))) {
      best = deploy;
      bestLag = lag;
    }
  }

  return best;
}

function isMoreSpecific(candidate: DeployMarker, current: DeployMarker | null): boolean {
  return candidate.monitorId !== null && current?.monitorId === null;
}
