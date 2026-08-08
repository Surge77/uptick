import { describe, expect, it } from "vitest";
import type { Observation } from "@uptick/core";
import {
  evaluateMonitor,
  type EvaluationInput,
  type MonitorPolicy,
  type OpenIncident,
} from "./evaluator.js";

const NOW = new Date("2026-01-01T12:00:00Z");

const policy: MonitorPolicy = {
  monitorId: "m1",
  confirmThreshold: 3,
  recoverThreshold: 2,
  degradedMs: 2000,
  quorum: 2,
  state: "UP",
};

/** Build `count` consecutive observations for one region. */
function obs(region: string, count: number, ok: boolean, latencyMs = 100): Observation[] {
  return Array.from({ length: count }, (_, i) => ({
    regionSlug: region,
    ts: new Date(NOW.getTime() - (count - i) * 60_000),
    ok,
    latencyMs,
    error: ok ? null : "ECONNREFUSED",
  }));
}

function input(over: Partial<EvaluationInput> = {}): EvaluationInput {
  return {
    policy,
    observations: [],
    activeRegionCount: 3,
    openIncident: null,
    recentTransitions: [],
    isFlapping: false,
    inMaintenance: false,
    now: NOW,
    ...over,
  };
}

const openIncident: OpenIncident = {
  id: "inc1",
  severity: "DOWN",
  startedAt: new Date("2026-01-01T11:00:00Z"),
};

describe("evaluateMonitor", () => {
  it("opens an incident when two regions confirm failure", () => {
    const result = evaluateMonitor(
      input({ observations: [...obs("fra", 3, false), ...obs("iad", 3, false)] }),
    );

    expect(result.action.kind).toBe("OPEN");
    if (result.action.kind === "OPEN") {
      expect(result.action.severity).toBe("DOWN");
      expect(result.action.failingRegions).toEqual(["fra", "iad"]);
      expect(result.action.cause).toContain("ECONNREFUSED");
    }
    expect(result.nextState).toBe("DOWN");
  });

  it("does not open when only one region fails", () => {
    const result = evaluateMonitor(
      input({ observations: [...obs("fra", 3, false), ...obs("iad", 2, true)] }),
    );

    expect(result.action.kind).toBe("NONE");
    expect(result.nextState).toBe("UP");
  });

  it("resolves the open incident on confirmed recovery", () => {
    const result = evaluateMonitor(
      input({
        policy: { ...policy, state: "DOWN" },
        openIncident,
        observations: [...obs("fra", 2, true), ...obs("iad", 2, true)],
      }),
    );

    expect(result.action).toEqual({ kind: "RESOLVE", incidentId: "inc1" });
    expect(result.nextState).toBe("UP");
  });

  it("escalates an existing incident rather than opening a second", () => {
    const result = evaluateMonitor(
      input({
        policy: { ...policy, state: "DEGRADED" },
        openIncident: { ...openIncident, severity: "DEGRADED" },
        observations: [...obs("fra", 3, false), ...obs("iad", 3, false)],
      }),
    );

    expect(result.action).toEqual({
      kind: "CHANGE_SEVERITY",
      incidentId: "inc1",
      severity: "DOWN",
    });
  });

  it("does not open a duplicate when state and incident table disagree", () => {
    // Reachable after a crash between writing the incident and the monitor
    // state. Opening a second incident would double-count the outage in SLA.
    const result = evaluateMonitor(
      input({
        policy: { ...policy, state: "UP" },
        openIncident,
        observations: [...obs("fra", 3, false), ...obs("iad", 3, false)],
      }),
    );

    expect(result.action.kind).toBe("NONE");
  });

  it("corrects severity drift without a state change", () => {
    // The monitor has been DOWN for several ticks but the incident was opened
    // as DEGRADED. Nothing transitions, yet the record is wrong.
    const result = evaluateMonitor(
      input({
        policy: { ...policy, state: "DOWN" },
        openIncident: { ...openIncident, severity: "DEGRADED" },
        observations: [...obs("fra", 3, false), ...obs("iad", 3, false)],
      }),
    );

    expect(result.verdict.changed).toBe(false);
    expect(result.action).toEqual({
      kind: "CHANGE_SEVERITY",
      incidentId: "inc1",
      severity: "DOWN",
    });
  });

  it("emits nothing when the state is unchanged and severity agrees", () => {
    const result = evaluateMonitor(
      input({
        policy: { ...policy, state: "DOWN" },
        openIncident,
        observations: [...obs("fra", 3, false), ...obs("iad", 3, false)],
      }),
    );

    expect(result.action.kind).toBe("NONE");
  });

  it("opens an incident if severity changes with no incident on record", () => {
    const result = evaluateMonitor(
      input({
        policy: { ...policy, state: "DEGRADED" },
        openIncident: null,
        observations: [...obs("fra", 3, false), ...obs("iad", 3, false)],
      }),
    );

    expect(result.action.kind).toBe("OPEN");
  });

  describe("suppression", () => {
    const failing = { observations: [...obs("fra", 3, false), ...obs("iad", 3, false)] };

    it("suppresses opening during a maintenance window", () => {
      const result = evaluateMonitor(input({ ...failing, inMaintenance: true }));

      expect(result.action.kind).toBe("NONE");
      expect(result.suppressed).toBe(true);
      expect(result.suppressionReason).toBe("maintenance window");
    });

    it("still advances the recorded state during maintenance", () => {
      // Suppression must hold back the alert, not the truth. Freezing the state
      // would leave the monitor stuck once the window closes.
      const result = evaluateMonitor(input({ ...failing, inMaintenance: true }));
      expect(result.nextState).toBe("DOWN");
    });

    it("never suppresses a resolution", () => {
      // Leaving an incident open because a window started after it would keep
      // the status page red for a demonstrably healthy service.
      const result = evaluateMonitor(
        input({
          policy: { ...policy, state: "DOWN" },
          openIncident,
          observations: [...obs("fra", 2, true), ...obs("iad", 2, true)],
          inMaintenance: true,
        }),
      );

      expect(result.action).toEqual({ kind: "RESOLVE", incidentId: "inc1" });
      expect(result.suppressed).toBe(false);
    });

    it("suppresses opening while the monitor is flapping", () => {
      const transitions = [1, 2, 3].map((m) => new Date(NOW.getTime() - m * 60_000));
      const result = evaluateMonitor(input({ ...failing, recentTransitions: transitions }));

      expect(result.verdict.isFlapping).toBe(true);
      expect(result.action.kind).toBe("NONE");
      expect(result.suppressionReason).toBe("flapping");
    });

    it("prefers the maintenance reason when both apply", () => {
      const transitions = [1, 2, 3].map((m) => new Date(NOW.getTime() - m * 60_000));
      const result = evaluateMonitor(
        input({ ...failing, recentTransitions: transitions, inMaintenance: true }),
      );
      expect(result.suppressionReason).toBe("maintenance window");
    });
  });

  it("respects a monitor's own quorum setting", () => {
    const result = evaluateMonitor(
      input({
        policy: { ...policy, quorum: 1 },
        observations: [...obs("fra", 3, false), ...obs("iad", 2, true)],
      }),
    );

    expect(result.action.kind).toBe("OPEN");
  });

  it("clamps quorum to the number of active regions", () => {
    // A monitor configured for 3-region quorum must not become un-alertable
    // when only one region is up.
    const result = evaluateMonitor(
      input({
        policy: { ...policy, quorum: 3 },
        activeRegionCount: 1,
        observations: obs("fra", 3, false),
      }),
    );

    expect(result.action.kind).toBe("OPEN");
  });

  it("opens a DEGRADED incident on sustained slowness", () => {
    const result = evaluateMonitor(
      input({
        observations: [...obs("fra", 3, true, 9000), ...obs("iad", 3, true, 9000)],
      }),
    );

    expect(result.action.kind).toBe("OPEN");
    if (result.action.kind === "OPEN") expect(result.action.severity).toBe("DEGRADED");
  });

  it("emits nothing with no observations at all", () => {
    const result = evaluateMonitor(input());
    expect(result.action.kind).toBe("NONE");
  });
});
