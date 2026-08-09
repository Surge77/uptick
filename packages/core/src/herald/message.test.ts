import { describe, expect, it } from "vitest";
import { buildAlert, type AlertContext } from "./message.js";

const NOW = new Date("2026-01-01T12:40:00Z");

function context(over: Partial<AlertContext> = {}): AlertContext {
  return {
    kind: "OPENED",
    monitorName: "Acme API",
    monitorTarget: "https://api.acme.com/health",
    severity: "DOWN",
    cause: "ECONNREFUSED",
    startedAt: new Date("2026-01-01T12:00:00Z"),
    resolvedAt: null,
    failingRegions: ["fra", "iad"],
    level: 0,
    now: NOW,
    ...over,
  };
}

describe("buildAlert", () => {
  it("titles an outage plainly", () => {
    expect(buildAlert(context()).title).toBe("Acme API is DOWN");
  });

  it("titles a degradation distinctly", () => {
    expect(buildAlert(context({ severity: "DEGRADED" })).title).toBe("Acme API is DEGRADED");
  });

  it("titles a recovery", () => {
    expect(buildAlert(context({ kind: "RESOLVED" })).title).toBe("Acme API has RECOVERED");
  });

  it("includes cause and failing regions", () => {
    const body = buildAlert(context()).body;
    expect(body).toContain("ECONNREFUSED");
    expect(body).toContain("fra, iad");
  });

  it("states how long the outage has been running", () => {
    // "The API is down" and "the API has been down for 40 minutes" prompt very
    // different responses; the reader should not derive it from timestamps.
    expect(buildAlert(context()).body).toContain("Ongoing for: 40m");
  });

  it("states total duration on resolution", () => {
    const body = buildAlert(
      context({ kind: "RESOLVED", resolvedAt: new Date("2026-01-01T14:05:00Z") }),
    ).body;
    expect(body).toContain("Duration: 2h 5m");
  });

  it("falls back to now when a resolution has no timestamp", () => {
    expect(buildAlert(context({ kind: "RESOLVED" })).body).toContain("Duration: 40m");
  });

  it("notes the escalation level and lack of acknowledgement", () => {
    const body = buildAlert(context({ kind: "ESCALATION", level: 2 })).body;
    expect(body).toContain("Escalation level: 2");
    expect(body).toContain("no acknowledgement");
  });

  it("omits the cause line when there is none", () => {
    expect(buildAlert(context({ cause: null })).body).not.toContain("Cause:");
  });

  it("omits failing regions when none are known", () => {
    expect(buildAlert(context({ failingRegions: [] })).body).not.toContain("Failing regions");
  });

  it("includes a link when one is supplied", () => {
    const body = buildAlert(context({ incidentUrl: "https://uptick.app/i/1" })).body;
    expect(body).toContain("https://uptick.app/i/1");
  });

  const colors: Array<[Partial<AlertContext>, string]> = [
    [{ severity: "DOWN" }, "#dc2626"],
    [{ severity: "DEGRADED" }, "#f59e0b"],
    [{ kind: "RESOLVED" }, "#16a34a"],
  ];

  it.each(colors)("picks a severity colour", (over, expected) => {
    expect(buildAlert(context(over)).color).toBe(expected);
  });

  it("describes worsening and improving transitions", () => {
    expect(buildAlert(context({ kind: "ESCALATED" })).title).toContain("worsened to DOWN");
    expect(buildAlert(context({ kind: "DOWNGRADED" })).title).toContain("improved to DEGRADED");
  });
});
