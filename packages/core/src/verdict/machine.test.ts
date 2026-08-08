import { describe, expect, it } from "vitest";
import { effectiveQuorum, evaluate, resolveQuorum } from "./machine.js";
import {
  DEFAULT_VERDICT_POLICY,
  type MonitorState,
  type RegionVerdict,
  type VerdictContext,
  type VerdictPolicy,
} from "./types.js";

const NOW = new Date("2026-01-01T12:00:00Z");
const policy: VerdictPolicy = { ...DEFAULT_VERDICT_POLICY };

function region(
  slug: string,
  state: RegionVerdict["state"],
  lastError: string | null = null,
): RegionVerdict {
  return {
    regionSlug: slug,
    state,
    consecutiveFailures: state === "DOWN" ? 3 : 0,
    consecutiveSuccesses: state === "UP" ? 2 : 0,
    lastObservedAt: NOW,
    lastError,
  };
}

function context(state: MonitorState, transitions: Date[] = []): VerdictContext {
  return { state, recentTransitions: transitions, isFlapping: false };
}

describe("effectiveQuorum", () => {
  const cases: Array<[string, Partial<VerdictPolicy>, number]> = [
    ["uses the configured quorum when regions allow", { quorum: 2, activeRegionCount: 3 }, 2],
    ["clamps down to the active region count", { quorum: 3, activeRegionCount: 2 }, 2],
    ["never falls below 1", { quorum: 0, activeRegionCount: 3 }, 1],
    ["works for a single-region deployment", { quorum: 2, activeRegionCount: 1 }, 1],
    ["treats zero active regions as one", { quorum: 2, activeRegionCount: 0 }, 1],
  ];

  it.each(cases)("%s", (_name, overrides, expected) => {
    expect(effectiveQuorum({ ...policy, ...overrides })).toBe(expected);
  });
});

describe("resolveQuorum", () => {
  it("returns null when no state has enough agreement", () => {
    const outcome = resolveQuorum([region("fra", "DOWN"), region("iad", "UP")], policy);
    expect(outcome.state).toBeNull();
    expect(outcome.dissenting).toEqual(["fra", "iad"]);
  });

  it("resolves DOWN when enough regions agree", () => {
    const outcome = resolveQuorum(
      [region("fra", "DOWN"), region("iad", "DOWN"), region("sin", "UP")],
      policy,
    );
    expect(outcome.state).toBe("DOWN");
    expect(outcome.agreeing).toEqual(["fra", "iad"]);
    expect(outcome.dissenting).toEqual(["sin"]);
  });

  it("prefers the worse severity when both reach quorum", () => {
    // With quorum 1, both DOWN and UP qualify. A healthy minority must never
    // mask a genuine outage.
    const single: VerdictPolicy = { ...policy, quorum: 1, activeRegionCount: 3 };
    const outcome = resolveQuorum([region("fra", "DOWN"), region("iad", "UP")], single);
    expect(outcome.state).toBe("DOWN");
  });

  it("resolves DEGRADED over UP", () => {
    const outcome = resolveQuorum(
      [region("fra", "DEGRADED"), region("iad", "DEGRADED"), region("sin", "UP")],
      policy,
    );
    expect(outcome.state).toBe("DEGRADED");
  });

  it("ignores PENDING regions entirely", () => {
    const outcome = resolveQuorum(
      [region("fra", "PENDING"), region("iad", "PENDING"), region("sin", "UP")],
      policy,
    );
    expect(outcome.state).toBeNull();
  });

  it("returns null for no regions", () => {
    expect(resolveQuorum([], policy).state).toBeNull();
  });
});

describe("evaluate", () => {
  it("opens an incident when a healthy monitor goes down with quorum", () => {
    const verdict = evaluate(
      context("UP"),
      [region("fra", "DOWN", "ECONNREFUSED"), region("iad", "DOWN"), region("sin", "UP")],
      policy,
      NOW,
    );

    expect(verdict.state).toBe("DOWN");
    expect(verdict.changed).toBe(true);
    expect(verdict.action).toEqual({ type: "OPEN_INCIDENT", severity: "DOWN" });
    expect(verdict.cause).toContain("ECONNREFUSED");
  });

  it("does NOT open an incident when only one region fails", () => {
    // The headline guarantee: a single region losing connectivity to the target
    // is not a global outage.
    const verdict = evaluate(
      context("UP"),
      [region("fra", "DOWN"), region("iad", "UP"), region("sin", "UP")],
      policy,
      NOW,
    );

    expect(verdict.state).toBe("UP");
    expect(verdict.changed).toBe(false);
    expect(verdict.action).toEqual({ type: "NONE" });
  });

  it("holds the previous state when regions disagree with no quorum", () => {
    const verdict = evaluate(
      context("UP"),
      [region("fra", "DOWN"), region("iad", "DEGRADED"), region("sin", "UP")],
      policy,
      NOW,
    );

    expect(verdict.quorumBlocked).toBe(true);
    expect(verdict.state).toBe("UP");
    expect(verdict.changed).toBe(false);
  });

  it("resolves the incident on confirmed recovery", () => {
    const verdict = evaluate(
      context("DOWN"),
      [region("fra", "UP"), region("iad", "UP"), region("sin", "DOWN")],
      policy,
      NOW,
    );

    expect(verdict.state).toBe("UP");
    expect(verdict.action).toEqual({ type: "RESOLVE_INCIDENT" });
    expect(verdict.cause).toBeNull();
  });

  it("emits no action while the state is unchanged", () => {
    const verdict = evaluate(
      context("DOWN"),
      [region("fra", "DOWN"), region("iad", "DOWN")],
      policy,
      NOW,
    );

    expect(verdict.changed).toBe(false);
    expect(verdict.action).toEqual({ type: "NONE" });
  });

  it("escalates severity rather than opening a second incident", () => {
    // A degradation that worsens into an outage is one event, not two.
    const verdict = evaluate(
      context("DEGRADED"),
      [region("fra", "DOWN"), region("iad", "DOWN")],
      policy,
      NOW,
    );

    expect(verdict.action).toEqual({ type: "ESCALATE_SEVERITY", severity: "DOWN" });
  });

  it("downgrades severity when an outage improves to degraded", () => {
    const verdict = evaluate(
      context("DOWN"),
      [region("fra", "DEGRADED"), region("iad", "DEGRADED")],
      policy,
      NOW,
    );

    expect(verdict.action).toEqual({ type: "DOWNGRADE_SEVERITY", severity: "DEGRADED" });
  });

  it("opens a DEGRADED incident from a healthy state", () => {
    const verdict = evaluate(
      context("UP"),
      [region("fra", "DEGRADED"), region("iad", "DEGRADED")],
      policy,
      NOW,
    );

    expect(verdict.action).toEqual({ type: "OPEN_INCIDENT", severity: "DEGRADED" });
    expect(verdict.cause).toContain("latency");
  });

  it("opens an incident from PENDING on first confirmed failure", () => {
    const verdict = evaluate(
      context("PENDING"),
      [region("fra", "DOWN"), region("iad", "DOWN")],
      policy,
      NOW,
    );

    expect(verdict.action).toEqual({ type: "OPEN_INCIDENT", severity: "DOWN" });
  });

  it("emits no incident when moving from PENDING to UP", () => {
    const verdict = evaluate(
      context("PENDING"),
      [region("fra", "UP"), region("iad", "UP")],
      policy,
      NOW,
    );

    expect(verdict.changed).toBe(true);
    expect(verdict.action).toEqual({ type: "NONE" });
  });

  it("never evaluates a paused monitor", () => {
    const verdict = evaluate(
      context("PAUSED"),
      [region("fra", "DOWN"), region("iad", "DOWN"), region("sin", "DOWN")],
      policy,
      NOW,
    );

    expect(verdict.state).toBe("PAUSED");
    expect(verdict.changed).toBe(false);
    expect(verdict.action).toEqual({ type: "NONE" });
  });

  it("falls back to a generic cause when no region reported an error", () => {
    const verdict = evaluate(
      context("UP"),
      [region("fra", "DOWN"), region("iad", "DOWN")],
      policy,
      NOW,
    );
    expect(verdict.cause).toBe("Unreachable from 2 region(s)");
  });

  describe("flap detection", () => {
    const recent = (minutesAgo: number[]) =>
      minutesAgo.map((m) => new Date(NOW.getTime() - m * 60_000));

    it("does not flag a first transition as flapping", () => {
      const verdict = evaluate(
        context("UP"),
        [region("fra", "DOWN"), region("iad", "DOWN")],
        policy,
        NOW,
      );
      expect(verdict.isFlapping).toBe(false);
      expect(verdict.recentTransitions).toHaveLength(1);
    });

    it("flags flapping once transitions reach the threshold in the window", () => {
      const verdict = evaluate(
        context("UP", recent([1, 2, 3])),
        [region("fra", "DOWN"), region("iad", "DOWN")],
        policy,
        NOW,
      );
      // Three prior transitions plus this one meets flapThreshold of 4.
      expect(verdict.recentTransitions).toHaveLength(4);
      expect(verdict.isFlapping).toBe(true);
    });

    it("forgets transitions older than the flap window", () => {
      // 20, 30 and 40 minutes ago all fall outside the 10-minute window.
      const verdict = evaluate(
        context("UP", recent([20, 30, 40])),
        [region("fra", "DOWN"), region("iad", "DOWN")],
        policy,
        NOW,
      );
      expect(verdict.recentTransitions).toHaveLength(1);
      expect(verdict.isFlapping).toBe(false);
    });

    it("prunes stale transitions even when nothing changes", () => {
      const verdict = evaluate(
        context("UP", recent([20, 30])),
        [region("fra", "UP"), region("iad", "UP")],
        policy,
        NOW,
      );
      expect(verdict.changed).toBe(false);
      expect(verdict.recentTransitions).toHaveLength(0);
    });

    it("prunes stale transitions when quorum is blocked", () => {
      const verdict = evaluate(
        context("UP", recent([20])),
        [region("fra", "DOWN"), region("iad", "UP")],
        policy,
        NOW,
      );
      expect(verdict.quorumBlocked).toBe(true);
      expect(verdict.recentTransitions).toHaveLength(0);
    });

    it("does not mutate the caller's transition array", () => {
      const transitions = recent([1, 2]);
      evaluate(
        context("UP", transitions),
        [region("fra", "DOWN"), region("iad", "DOWN")],
        policy,
        NOW,
      );
      expect(transitions).toHaveLength(2);
    });
  });
});
