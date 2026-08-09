import { describe, expect, it } from "vitest";
import { suppressIncidents, type DependencyEdge, type OpenIncident } from "./suppression.js";

const T0 = new Date("2026-01-01T00:00:00Z");
const at = (minutes: number) => new Date(T0.getTime() + minutes * 60_000);

function incident(
  id: string,
  monitorId: string,
  start = 0,
  end: number | null = null,
): OpenIncident {
  return { id, monitorId, startedAt: at(start), resolvedAt: end === null ? null : at(end) };
}

const edge = (monitorId: string, dependsOnId: string): DependencyEdge => ({
  monitorId,
  dependsOnId,
});

describe("suppressIncidents", () => {
  it("treats a lone incident as a root cause", () => {
    const result = suppressIncidents([incident("i1", "db")], []);
    expect(result.roots).toEqual(["i1"]);
    expect(result.suppressed.size).toBe(0);
  });

  it("attributes a dependent outage to its failing dependency", () => {
    const result = suppressIncidents(
      [incident("i-db", "db"), incident("i-api", "api")],
      [edge("api", "db")],
    );

    expect(result.roots).toEqual(["i-db"]);
    expect(result.suppressed.get("i-api")).toBe("i-db");
  });

  it("does not suppress when the dependency is healthy", () => {
    const result = suppressIncidents([incident("i-api", "api")], [edge("api", "db")]);
    expect(result.roots).toEqual(["i-api"]);
    expect(result.suppressed.size).toBe(0);
  });

  it("does not suppress when outages do not overlap in time", () => {
    const result = suppressIncidents(
      [incident("i-db", "db", 0, 10), incident("i-api", "api", 30, 40)],
      [edge("api", "db")],
    );

    expect(result.roots).toContain("i-api");
    expect(result.suppressed.size).toBe(0);
  });

  it("prefers the nearest failing ancestor over a more distant one", () => {
    // web -> api -> db, with both api and db failing.
    const result = suppressIncidents(
      [incident("i-db", "db"), incident("i-api", "api"), incident("i-web", "web")],
      [edge("web", "api"), edge("api", "db")],
    );

    expect(result.suppressed.get("i-web")).toBe("i-api");
    expect(result.suppressed.get("i-api")).toBe("i-db");
    expect(result.roots).toEqual(["i-db"]);
  });

  it("suppresses through a healthy intermediate hop", () => {
    // web -> api -> db, but only db is failing.
    const result = suppressIncidents(
      [incident("i-db", "db"), incident("i-web", "web")],
      [edge("web", "api"), edge("api", "db")],
    );

    expect(result.suppressed.get("i-web")).toBe("i-db");
    expect(result.roots).toEqual(["i-db"]);
  });

  it("terminates on a dependency cycle instead of hanging", () => {
    const result = suppressIncidents(
      [incident("i-a", "a"), incident("i-b", "b")],
      [edge("a", "b"), edge("b", "a")],
    );

    // Each blames the other; what matters is that it returns.
    expect(result.suppressed.size + result.roots.length).toBe(2);
  });

  it("handles a diamond without double-counting", () => {
    // web depends on both api and cache; only cache is failing.
    const result = suppressIncidents(
      [incident("i-cache", "cache"), incident("i-web", "web")],
      [edge("web", "api"), edge("web", "cache"), edge("api", "db")],
    );

    expect(result.suppressed.get("i-web")).toBe("i-cache");
    expect(result.roots).toEqual(["i-cache"]);
  });

  it("keeps an unrelated outage as its own root", () => {
    const result = suppressIncidents(
      [incident("i-db", "db"), incident("i-api", "api"), incident("i-mail", "mail")],
      [edge("api", "db")],
    );

    expect(result.roots.sort()).toEqual(["i-db", "i-mail"]);
    expect(result.suppressed.get("i-api")).toBe("i-db");
  });
});
