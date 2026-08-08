/**
 * Types for the verdict subsystem.
 *
 * These deliberately mirror a subset of the Prisma models rather than importing
 * them: `@uptick/core` must stay free of a database dependency so the decision
 * logic can be tested without infrastructure.
 */

/** Confirmed state of a monitor. Never the result of a single probe. */
export type MonitorState = "PENDING" | "UP" | "DEGRADED" | "DOWN" | "PAUSED";

/** One probe result as observed by one region. */
export interface Observation {
  regionSlug: string;
  ts: Date;
  ok: boolean;
  latencyMs: number | null;
  error?: string | null;
}

/** The policy that governs how observations become conclusions. */
export interface VerdictPolicy {
  /**
   * Consecutive failures required before declaring DOWN. A single failed probe
   * usually means the prober's network blipped, not that the target is down.
   */
  confirmThreshold: number;
  /** Consecutive successes required before declaring recovery. */
  recoverThreshold: number;
  /** Latency above this is DEGRADED: up, but slow. Null disables the check. */
  degradedMs: number | null;
  /** Regions that must agree before a state change is accepted. */
  quorum: number;
  /** Number of currently active regions; `quorum` is clamped to this. */
  activeRegionCount: number;
  /** Transitions within `flapWindowMs` before the monitor is judged flapping. */
  flapThreshold: number;
  flapWindowMs: number;
}

export const DEFAULT_VERDICT_POLICY: VerdictPolicy = {
  confirmThreshold: 3,
  recoverThreshold: 2,
  degradedMs: 2000,
  quorum: 2,
  activeRegionCount: 3,
  flapThreshold: 4,
  flapWindowMs: 10 * 60 * 1000,
};

/** What a region currently believes, derived from its own recent observations. */
export interface RegionVerdict {
  regionSlug: string;
  /** The state this region's observations alone would support. */
  state: Exclude<MonitorState, "PAUSED">;
  consecutiveFailures: number;
  consecutiveSuccesses: number;
  lastObservedAt: Date | null;
  lastError?: string | null;
}

/** Prior state carried between evaluations. Persisted by the caller. */
export interface VerdictContext {
  state: MonitorState;
  /** Timestamps of recent confirmed transitions, used for flap detection. */
  recentTransitions: readonly Date[];
  isFlapping: boolean;
}

export type VerdictAction =
  | { type: "NONE" }
  | { type: "OPEN_INCIDENT"; severity: "DEGRADED" | "DOWN" }
  | { type: "RESOLVE_INCIDENT" }
  | { type: "ESCALATE_SEVERITY"; severity: "DOWN" }
  | { type: "DOWNGRADE_SEVERITY"; severity: "DEGRADED" };

/** The outcome of evaluating one monitor at one instant. */
export interface Verdict {
  state: MonitorState;
  previousState: MonitorState;
  changed: boolean;
  action: VerdictAction;
  /** True when quorum was not reached, so no state change was accepted. */
  quorumBlocked: boolean;
  agreeingRegions: string[];
  dissentingRegions: string[];
  isFlapping: boolean;
  recentTransitions: Date[];
  cause: string | null;
}
