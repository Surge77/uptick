import {
  evaluate,
  foldRegions,
  type MonitorState,
  type Observation,
  type Verdict,
  type VerdictContext,
  type VerdictPolicy,
} from "@uptick/core";

/**
 * Turns recent observations into incident actions.
 *
 * Pure: every input is supplied by the caller, so the full transition matrix
 * (open, resolve, escalate, suppress) is testable without a database.
 */

export interface MonitorPolicy {
  monitorId: string;
  confirmThreshold: number;
  recoverThreshold: number;
  degradedMs: number | null;
  quorum: number;
  state: MonitorState;
}

export interface OpenIncident {
  id: string;
  severity: "DEGRADED" | "DOWN";
  startedAt: Date;
}

export interface EvaluationInput {
  policy: MonitorPolicy;
  observations: readonly Observation[];
  activeRegionCount: number;
  openIncident: OpenIncident | null;
  recentTransitions: readonly Date[];
  isFlapping: boolean;
  /** True while a maintenance window covers `now`. */
  inMaintenance: boolean;
  now: Date;
}

export type IncidentAction =
  | { kind: "NONE" }
  | { kind: "OPEN"; severity: "DEGRADED" | "DOWN"; cause: string | null; failingRegions: string[] }
  | { kind: "RESOLVE"; incidentId: string }
  | { kind: "CHANGE_SEVERITY"; incidentId: string; severity: "DEGRADED" | "DOWN" };

export interface Evaluation {
  verdict: Verdict;
  action: IncidentAction;
  /** Whether the state change should be persisted on the monitor. */
  nextState: MonitorState;
  /** True when an action was computed but deliberately not taken. */
  suppressed: boolean;
  suppressionReason: string | null;
}

export const DEFAULT_FLAP_THRESHOLD = 4;
export const DEFAULT_FLAP_WINDOW_MS = 10 * 60 * 1000;

/**
 * Evaluate one monitor.
 *
 * Suppression is applied AFTER the verdict, never before. The state machine
 * must still see the truth and record the transition even while alerting is
 * held back — otherwise a monitor that recovers during a maintenance window
 * would be stuck reporting DOWN once the window closed.
 */
export function evaluateMonitor(input: EvaluationInput): Evaluation {
  const policy: VerdictPolicy = {
    confirmThreshold: input.policy.confirmThreshold,
    recoverThreshold: input.policy.recoverThreshold,
    degradedMs: input.policy.degradedMs,
    quorum: input.policy.quorum,
    activeRegionCount: input.activeRegionCount,
    flapThreshold: DEFAULT_FLAP_THRESHOLD,
    flapWindowMs: DEFAULT_FLAP_WINDOW_MS,
  };

  const context: VerdictContext = {
    state: input.policy.state,
    recentTransitions: input.recentTransitions,
    isFlapping: input.isFlapping,
  };

  const regions = foldRegions(input.observations, policy);
  const verdict = evaluate(context, regions, policy, input.now);

  const failingRegions = regions
    .filter((r) => r.state === "DOWN" || r.state === "DEGRADED")
    .map((r) => r.regionSlug);

  if (!verdict.changed) {
    // An incident may still need its severity corrected: the monitor can sit in
    // DOWN across ticks while an earlier incident was opened as DEGRADED.
    const drifted =
      input.openIncident !== null &&
      (verdict.state === "DOWN" || verdict.state === "DEGRADED") &&
      input.openIncident.severity !== verdict.state;

    if (drifted) {
      return {
        verdict,
        action: {
          kind: "CHANGE_SEVERITY",
          incidentId: input.openIncident!.id,
          severity: verdict.state as "DEGRADED" | "DOWN",
        },
        nextState: verdict.state,
        suppressed: false,
        suppressionReason: null,
      };
    }

    return {
      verdict,
      action: { kind: "NONE" },
      nextState: verdict.state,
      suppressed: false,
      suppressionReason: null,
    };
  }

  const action = toIncidentAction(verdict, input.openIncident, failingRegions);

  // Resolution is never suppressed. Leaving an incident open because a
  // maintenance window started after it opened would keep the status page red
  // for a service that is demonstrably healthy.
  const isResolution = action.kind === "RESOLVE";

  if (!isResolution && input.inMaintenance) {
    return {
      verdict,
      action: { kind: "NONE" },
      nextState: verdict.state,
      suppressed: true,
      suppressionReason: "maintenance window",
    };
  }

  if (!isResolution && verdict.isFlapping) {
    return {
      verdict,
      action: { kind: "NONE" },
      nextState: verdict.state,
      suppressed: true,
      suppressionReason: "flapping",
    };
  }

  return { verdict, action, nextState: verdict.state, suppressed: false, suppressionReason: null };
}

function toIncidentAction(
  verdict: Verdict,
  openIncident: OpenIncident | null,
  failingRegions: string[],
): IncidentAction {
  switch (verdict.action.type) {
    case "OPEN_INCIDENT":
      // Guard against opening a duplicate: the monitor's persisted state and
      // the incident table can disagree after a crash mid-write.
      if (openIncident) {
        return openIncident.severity === verdict.action.severity
          ? { kind: "NONE" }
          : {
              kind: "CHANGE_SEVERITY",
              incidentId: openIncident.id,
              severity: verdict.action.severity,
            };
      }
      return {
        kind: "OPEN",
        severity: verdict.action.severity,
        cause: verdict.cause,
        failingRegions,
      };

    case "RESOLVE_INCIDENT":
      return openIncident ? { kind: "RESOLVE", incidentId: openIncident.id } : { kind: "NONE" };

    case "ESCALATE_SEVERITY":
    case "DOWNGRADE_SEVERITY":
      return openIncident
        ? {
            kind: "CHANGE_SEVERITY",
            incidentId: openIncident.id,
            severity: verdict.action.severity,
          }
        : {
            kind: "OPEN",
            severity: verdict.action.severity,
            cause: verdict.cause,
            failingRegions,
          };

    case "NONE":
      return { kind: "NONE" };
  }
}
