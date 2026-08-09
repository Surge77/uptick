import { describe, expect, it } from "vitest";
import { correlateDeploys, type DeployMarker } from "./correlate.js";
import { minutes } from "../time.js";

const T0 = new Date("2026-01-01T12:00:00Z");
const at = (offsetMinutes: number) => new Date(T0.getTime() + offsetMinutes * 60_000);

const incident = (id: string, monitorId: string, offsetMinutes: number) => ({
  id,
  monitorId,
  startedAt: at(offsetMinutes),
});

const deploy = (
  id: string,
  offsetMinutes: number,
  monitorId: string | null = null,
): DeployMarker => ({ id, label: `deploy ${id}`, ts: at(offsetMinutes), monitorId });

describe("correlateDeploys", () => {
  it("links an outage to a deploy shortly before it", () => {
    const result = correlateDeploys([incident("i1", "api", 3)], [deploy("d1", 0)]);

    expect(result).toHaveLength(1);
    expect(result[0]?.deployId).toBe("d1");
    expect(result[0]?.lagMs).toBe(minutes(3));
    expect(result[0]?.confidence).toBe("likely");
  });

  it("downgrades confidence as the lag grows", () => {
    const result = correlateDeploys([incident("i1", "api", 20)], [deploy("d1", 0)]);
    expect(result[0]?.confidence).toBe("possible");
  });

  it("ignores deploys outside the correlation window", () => {
    expect(correlateDeploys([incident("i1", "api", 45)], [deploy("d1", 0)])).toEqual([]);
  });

  it("never blames a deploy that happened after the outage started", () => {
    expect(correlateDeploys([incident("i1", "api", 0)], [deploy("d1", 5)])).toEqual([]);
  });

  it("picks the closest preceding deploy when several qualify", () => {
    const result = correlateDeploys(
      [incident("i1", "api", 10)],
      [deploy("d-old", 0), deploy("d-recent", 8)],
    );
    expect(result[0]?.deployId).toBe("d-recent");
  });

  it("ignores a deploy scoped to a different monitor", () => {
    const result = correlateDeploys([incident("i1", "api", 3)], [deploy("d1", 0, "web")]);
    expect(result).toEqual([]);
  });

  it("applies an org-wide deploy to any monitor", () => {
    const result = correlateDeploys([incident("i1", "api", 3)], [deploy("d1", 0, null)]);
    expect(result[0]?.deployId).toBe("d1");
  });

  it("prefers a monitor-specific deploy over an org-wide one at the same time", () => {
    const result = correlateDeploys(
      [incident("i1", "api", 3)],
      [deploy("d-org", 0, null), deploy("d-api", 0, "api")],
    );
    expect(result[0]?.deployId).toBe("d-api");
  });

  it("returns nothing when there were no deploys", () => {
    expect(correlateDeploys([incident("i1", "api", 3)], [])).toEqual([]);
  });

  it("correlates each incident independently", () => {
    const result = correlateDeploys(
      [incident("i1", "api", 2), incident("i2", "web", 4)],
      [deploy("d-api", 0, "api"), deploy("d-web", 1, "web")],
    );

    expect(result).toHaveLength(2);
    expect(result.find((c) => c.incidentId === "i1")?.deployId).toBe("d-api");
    expect(result.find((c) => c.incidentId === "i2")?.deployId).toBe("d-web");
  });

  it("honours a custom correlation window", () => {
    const tight = correlateDeploys([incident("i1", "api", 20)], [deploy("d1", 0)], minutes(10));
    expect(tight).toEqual([]);
  });
});
