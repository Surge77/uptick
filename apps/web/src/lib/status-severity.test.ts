import { describe, expect, it } from "vitest";
import { worstState } from "./status-severity";

describe("worstState", () => {
  it("reports UP when every component is up", () => {
    expect(worstState(["UP", "UP", "UP"])).toBe("UP");
  });

  it("reports UP for an empty component list", () => {
    expect(worstState([])).toBe("UP");
  });

  it("surfaces a single DOWN component over a healthy majority", () => {
    expect(worstState(["UP", "UP", "DOWN", "UP"])).toBe("DOWN");
  });

  it("prefers DOWN over DEGRADED", () => {
    expect(worstState(["DEGRADED", "DOWN"])).toBe("DOWN");
  });

  it("reports DEGRADED when nothing is fully down", () => {
    expect(worstState(["UP", "DEGRADED", "PENDING"])).toBe("DEGRADED");
  });

  it("does not let a paused component dominate the headline", () => {
    expect(worstState(["UP", "PAUSED"])).toBe("PAUSED");
    expect(worstState(["DEGRADED", "PAUSED"])).toBe("DEGRADED");
  });
});
