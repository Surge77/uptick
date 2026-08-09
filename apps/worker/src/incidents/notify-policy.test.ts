import { describe, expect, it } from "vitest";
import { shouldNotify } from "./notify-policy.js";

describe("shouldNotify", () => {
  it("pages for an unsuppressed incident opening", () => {
    expect(shouldNotify("OPENED", false)).toBe(true);
  });

  it("withholds the page when an upstream failure explains the outage", () => {
    expect(shouldNotify("OPENED", true)).toBe(false);
  });

  it("still reports resolution for a suppressed incident", () => {
    expect(shouldNotify("RESOLVED", true)).toBe(true);
  });

  it("still reports escalation and downgrade for a suppressed incident", () => {
    expect(shouldNotify("ESCALATED", true)).toBe(true);
    expect(shouldNotify("DOWNGRADED", true)).toBe(true);
  });

  it("passes every kind through when nothing is suppressed", () => {
    for (const kind of ["OPENED", "RESOLVED", "ESCALATED", "DOWNGRADED"] as const) {
      expect(shouldNotify(kind, false)).toBe(true);
    }
  });
});
