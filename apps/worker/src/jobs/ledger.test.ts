import { describe, expect, it } from "vitest";
import { daysToRollup } from "./ledger.js";

describe("daysToRollup", () => {
  it("returns yesterday and today as UTC midnights", () => {
    const days = daysToRollup(new Date("2026-03-15T13:45:00Z"));

    expect(days).toHaveLength(2);
    expect(days[0]!.toISOString()).toBe("2026-03-14T00:00:00.000Z");
    expect(days[1]!.toISOString()).toBe("2026-03-15T00:00:00.000Z");
  });

  it("includes today so the current day's bars are not a day stale", () => {
    // Rolling up only yesterday would leave the status page showing nothing
    // for the day in progress.
    const days = daysToRollup(new Date("2026-03-15T00:00:01Z"));
    expect(days[1]!.toISOString()).toBe("2026-03-15T00:00:00.000Z");
  });

  it("crosses a month boundary correctly", () => {
    const days = daysToRollup(new Date("2026-03-01T02:00:00Z"));
    expect(days[0]!.toISOString()).toBe("2026-02-28T00:00:00.000Z");
  });

  it("crosses a year boundary correctly", () => {
    const days = daysToRollup(new Date("2026-01-01T00:30:00Z"));
    expect(days[0]!.toISOString()).toBe("2025-12-31T00:00:00.000Z");
  });

  it("is unaffected by the runner's local timezone", () => {
    // A local-time implementation would bucket this differently depending on
    // where CI happens to run, making rollups machine-dependent.
    const days = daysToRollup(new Date("2026-03-15T23:59:59Z"));
    expect(days[1]!.toISOString()).toBe("2026-03-15T00:00:00.000Z");
  });
});
