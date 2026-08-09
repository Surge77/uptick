import { describe, expect, it } from "vitest";
import { burnRate, computeErrorBudget } from "./budget.js";
import { days, minutes } from "../time.js";

const START = new Date("2026-01-01T00:00:00Z");
const WINDOW = { start: START, end: new Date(START.getTime() + days(30)) };

function outage(offsetMs: number, lengthMs: number) {
  return {
    start: new Date(START.getTime() + offsetMs),
    end: new Date(START.getTime() + offsetMs + lengthMs),
    severity: "DOWN" as const,
  };
}

describe("computeErrorBudget", () => {
  it("allows about 43 minutes of downtime for 99.9% over 30 days", () => {
    const result = computeErrorBudget({
      window: WINDOW,
      objective: 99.9,
      incidents: [],
      maintenance: [],
      countDegraded: false,
    });

    expect(Math.round(result.allowedMs / 60_000)).toBe(43);
    expect(result.consumedMs).toBe(0);
    expect(result.exhausted).toBe(false);
  });

  it("subtracts an outage from the remaining budget", () => {
    const result = computeErrorBudget({
      window: WINDOW,
      objective: 99.9,
      incidents: [outage(days(1), minutes(10))],
      maintenance: [],
      countDegraded: false,
    });

    expect(result.consumedMs).toBe(minutes(10));
    expect(Math.round(result.remainingMs / 60_000)).toBe(33);
    expect(result.consumedFraction).toBeGreaterThan(0.2);
    expect(result.exhausted).toBe(false);
  });

  it("marks the budget exhausted once the objective is missed", () => {
    const result = computeErrorBudget({
      window: WINDOW,
      objective: 99.9,
      incidents: [outage(days(1), minutes(90))],
      maintenance: [],
      countDegraded: false,
    });

    expect(result.exhausted).toBe(true);
    expect(result.remainingMs).toBe(0);
    expect(result.consumedFraction).toBeGreaterThan(1);
  });

  it("does not spend budget on planned maintenance", () => {
    const maintenanceWindow = {
      start: new Date(START.getTime() + days(1)),
      end: new Date(START.getTime() + days(1) + minutes(30)),
    };

    const result = computeErrorBudget({
      window: WINDOW,
      objective: 99.9,
      incidents: [outage(days(1), minutes(30))],
      maintenance: [maintenanceWindow],
      countDegraded: false,
    });

    expect(result.consumedMs).toBe(0);
    expect(result.exhausted).toBe(false);
  });

  it("treats a 100% objective as allowing no downtime", () => {
    const clean = computeErrorBudget({
      window: WINDOW,
      objective: 100,
      incidents: [],
      maintenance: [],
      countDegraded: false,
    });
    expect(clean.allowedMs).toBe(0);
    expect(clean.consumedFraction).toBe(0);
    expect(clean.exhausted).toBe(true);

    const broken = computeErrorBudget({
      window: WINDOW,
      objective: 100,
      incidents: [outage(0, minutes(1))],
      maintenance: [],
      countDegraded: false,
    });
    expect(broken.consumedFraction).toBe(1);
    expect(broken.exhausted).toBe(true);
  });

  it("ignores degraded periods unless asked to count them", () => {
    const degraded = {
      start: new Date(START.getTime() + days(1)),
      end: new Date(START.getTime() + days(1) + minutes(20)),
      severity: "DEGRADED" as const,
    };

    const excluded = computeErrorBudget({
      window: WINDOW,
      objective: 99.9,
      incidents: [degraded],
      maintenance: [],
      countDegraded: false,
    });
    expect(excluded.consumedMs).toBe(0);

    const included = computeErrorBudget({
      window: WINDOW,
      objective: 99.9,
      incidents: [degraded],
      maintenance: [],
      countDegraded: true,
    });
    expect(included.consumedMs).toBe(minutes(20));
  });
});

describe("burnRate", () => {
  it("reports 1 when spend tracks elapsed time exactly", () => {
    const result = computeErrorBudget({
      window: WINDOW,
      objective: 99.9,
      incidents: [],
      maintenance: [],
      countDegraded: false,
    });
    expect(burnRate({ ...result, consumedFraction: 0.5 }, 0.5)).toBe(1);
  });

  it("reports above 1 when burning faster than the window elapses", () => {
    const result = computeErrorBudget({
      window: WINDOW,
      objective: 99.9,
      incidents: [],
      maintenance: [],
      countDegraded: false,
    });
    expect(burnRate({ ...result, consumedFraction: 0.5 }, 0.1)).toBe(5);
  });

  it("reports 0 before any time has elapsed", () => {
    const result = computeErrorBudget({
      window: WINDOW,
      objective: 99.9,
      incidents: [],
      maintenance: [],
      countDegraded: false,
    });
    expect(burnRate(result, 0)).toBe(0);
  });
});
