import type {
  MonitorState,
  RegionVerdict,
  Verdict,
  VerdictAction,
  VerdictContext,
  VerdictPolicy,
} from "./types.js";

/** Severity ordering, worst first. Quorum is evaluated in this order. */
const SEVERITY_ORDER = ["DOWN", "DEGRADED", "UP"] as const;

type CandidateState = (typeof SEVERITY_ORDER)[number];

export interface QuorumOutcome {
  /** The state that reached quorum, or null if none did. */
  state: CandidateState | null;
  required: number;
  agreeing: string[];
  dissenting: string[];
}

/**
 * The effective quorum for a monitor.
 *
 * Clamped to the number of active regions so a monitor configured for 3-region
 * quorum does not become permanently un-alertable when only 2 regions are up,
 * and floored at 1 so a single-region deployment still works.
 */
export function effectiveQuorum(policy: VerdictPolicy): number {
  const activeRegions = Math.max(1, policy.activeRegionCount);
  return Math.min(Math.max(1, policy.quorum), activeRegions);
}

/**
 * Decide which state, if any, enough regions agree on.
 *
 * Evaluated worst-severity-first: if 2 regions say DOWN and 1 says UP with a
 * quorum of 2, the answer is DOWN. Checking UP first would let a healthy
 * minority mask a genuine outage.
 */
export function resolveQuorum(
  regions: readonly RegionVerdict[],
  policy: VerdictPolicy,
): QuorumOutcome {
  const required = effectiveQuorum(policy);

  for (const candidate of SEVERITY_ORDER) {
    const agreeing = regions.filter((r) => r.state === candidate);
    if (agreeing.length >= required) {
      return {
        state: candidate,
        required,
        agreeing: agreeing.map((r) => r.regionSlug),
        dissenting: regions.filter((r) => r.state !== candidate).map((r) => r.regionSlug),
      };
    }
  }

  return {
    state: null,
    required,
    agreeing: [],
    dissenting: regions.map((r) => r.regionSlug),
  };
}

/** Transitions still inside the flap window, plus the new one if given. */
function pruneTransitions(
  transitions: readonly Date[],
  now: Date,
  windowMs: number,
  add?: Date,
): Date[] {
  const cutoff = now.getTime() - windowMs;
  const kept = transitions.filter((t) => t.getTime() >= cutoff);
  if (add) kept.push(add);
  return kept;
}

function isDown(state: MonitorState): boolean {
  return state === "DOWN" || state === "DEGRADED";
}

/**
 * Which side effect a transition implies.
 *
 * DEGRADED and DOWN are both incident-worthy, so moving between them adjusts an
 * existing incident's severity rather than opening a second one. An outage that
 * deepens from slow to unreachable is one event, not two.
 */
function actionFor(from: MonitorState, to: MonitorState): VerdictAction {
  const wasDown = isDown(from);
  const nowDown = isDown(to);

  if (!wasDown && nowDown) {
    return { type: "OPEN_INCIDENT", severity: to === "DOWN" ? "DOWN" : "DEGRADED" };
  }
  if (wasDown && !nowDown) {
    return { type: "RESOLVE_INCIDENT" };
  }
  if (from === "DEGRADED" && to === "DOWN") {
    return { type: "ESCALATE_SEVERITY", severity: "DOWN" };
  }
  if (from === "DOWN" && to === "DEGRADED") {
    return { type: "DOWNGRADE_SEVERITY", severity: "DEGRADED" };
  }
  return { type: "NONE" };
}

function describeCause(state: MonitorState, regions: readonly RegionVerdict[]): string | null {
  if (state === "UP") return null;

  const failing = regions.filter((r) => r.state === state);
  const withError = failing.find((r) => r.lastError);

  if (state === "DEGRADED") {
    return `Elevated latency observed from ${failing.length} region(s)`;
  }
  return withError?.lastError
    ? `${withError.lastError} (observed from ${failing.length} region(s))`
    : `Unreachable from ${failing.length} region(s)`;
}

/**
 * Evaluate one monitor at one instant.
 *
 * Pure: `now` is injected and nothing is read from the ambient clock, so every
 * branch below is reachable in a test without waiting for wall-clock time.
 */
export function evaluate(
  context: VerdictContext,
  regions: readonly RegionVerdict[],
  policy: VerdictPolicy,
  now: Date,
): Verdict {
  const previousState = context.state;

  // A paused monitor is not evaluated at all. Its observations, if any are
  // still arriving, must not resurrect alerting.
  if (previousState === "PAUSED") {
    return {
      state: "PAUSED",
      previousState,
      changed: false,
      action: { type: "NONE" },
      quorumBlocked: false,
      agreeingRegions: [],
      dissentingRegions: regions.map((r) => r.regionSlug),
      isFlapping: context.isFlapping,
      recentTransitions: [...context.recentTransitions],
      cause: null,
    };
  }

  const quorum = resolveQuorum(regions, policy);
  const kept = pruneTransitions(context.recentTransitions, now, policy.flapWindowMs);

  // No state reached quorum. Regions disagree, so nothing is concluded and the
  // previous state stands. This is the mechanism that stops one region's
  // connectivity problem from being reported as a global outage.
  if (quorum.state === null) {
    return {
      state: previousState,
      previousState,
      changed: false,
      action: { type: "NONE" },
      quorumBlocked: true,
      agreeingRegions: [],
      dissentingRegions: quorum.dissenting,
      isFlapping: context.isFlapping,
      recentTransitions: kept,
      cause: null,
    };
  }

  const nextState: MonitorState = quorum.state;

  if (nextState === previousState) {
    return {
      state: nextState,
      previousState,
      changed: false,
      action: { type: "NONE" },
      quorumBlocked: false,
      agreeingRegions: quorum.agreeing,
      dissentingRegions: quorum.dissenting,
      isFlapping: context.isFlapping,
      recentTransitions: kept,
      cause: describeCause(nextState, regions),
    };
  }

  const transitions = pruneTransitions(context.recentTransitions, now, policy.flapWindowMs, now);
  const isFlapping = transitions.length >= policy.flapThreshold;

  return {
    state: nextState,
    previousState,
    changed: true,
    action: actionFor(previousState, nextState),
    quorumBlocked: false,
    agreeingRegions: quorum.agreeing,
    dissentingRegions: quorum.dissenting,
    isFlapping,
    recentTransitions: transitions,
    cause: describeCause(nextState, regions),
  };
}
