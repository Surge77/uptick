import { describe, expect, it } from "vitest";
import {
  dedupeKey,
  inQuietHours,
  minutesOfDay,
  nextEscalationLevel,
  routeNotification,
  type RoutingChannel,
} from "./dedupe.js";

const NOW = new Date("2026-01-01T12:00:00Z");

describe("dedupeKey", () => {
  it("is stable for the same transition", () => {
    const input = { incidentId: "inc1", channelId: "ch1", kind: "OPENED" as const };
    expect(dedupeKey(input)).toBe(dedupeKey(input));
  });

  it("is identical no matter how many checks preceded it", () => {
    // The whole point: ten failed probes are one transition, so one alert. A
    // key derived from the check would produce ten.
    const key = dedupeKey({ incidentId: "inc1", channelId: "ch1", kind: "OPENED" });
    expect(key).toBe("inc1:OPENED:0");
  });

  it("distinguishes opening from resolving", () => {
    const opened = dedupeKey({ incidentId: "inc1", channelId: "ch1", kind: "OPENED" });
    const resolved = dedupeKey({ incidentId: "inc1", channelId: "ch1", kind: "RESOLVED" });
    expect(opened).not.toBe(resolved);
  });

  it("distinguishes escalation tiers for the same incident", () => {
    const first = dedupeKey({ incidentId: "i", channelId: "c", kind: "ESCALATION", level: 1 });
    const second = dedupeKey({ incidentId: "i", channelId: "c", kind: "ESCALATION", level: 2 });
    expect(first).not.toBe(second);
  });

  it("distinguishes different incidents", () => {
    const a = dedupeKey({ incidentId: "inc1", channelId: "ch1", kind: "OPENED" });
    const b = dedupeKey({ incidentId: "inc2", channelId: "ch1", kind: "OPENED" });
    expect(a).not.toBe(b);
  });
});

describe("minutesOfDay", () => {
  const cases: Array<[string, number]> = [
    ["2026-01-01T00:00:00Z", 0],
    ["2026-01-01T00:01:00Z", 1],
    ["2026-01-01T12:00:00Z", 720],
    ["2026-01-01T23:59:00Z", 1439],
  ];

  it.each(cases)("%s is minute %i", (iso, expected) => {
    expect(minutesOfDay(new Date(iso))).toBe(expected);
  });
});

describe("inQuietHours", () => {
  it("is false when no window is configured", () => {
    expect(inQuietHours(NOW, null)).toBe(false);
  });

  describe("a same-day window (09:00-17:00)", () => {
    const quiet = { startMinute: 540, endMinute: 1020 };

    it("is inside during the window", () => {
      expect(inQuietHours(new Date("2026-01-01T12:00:00Z"), quiet)).toBe(true);
    });

    it("includes the start minute", () => {
      expect(inQuietHours(new Date("2026-01-01T09:00:00Z"), quiet)).toBe(true);
    });

    it("excludes the end minute", () => {
      expect(inQuietHours(new Date("2026-01-01T17:00:00Z"), quiet)).toBe(false);
    });

    it("is outside before and after", () => {
      expect(inQuietHours(new Date("2026-01-01T08:59:00Z"), quiet)).toBe(false);
      expect(inQuietHours(new Date("2026-01-01T18:00:00Z"), quiet)).toBe(false);
    });
  });

  describe("an overnight window (22:00-06:00)", () => {
    // The normal case for quiet hours, not an exception.
    const quiet = { startMinute: 1320, endMinute: 360 };

    it("is inside late at night", () => {
      expect(inQuietHours(new Date("2026-01-01T23:30:00Z"), quiet)).toBe(true);
    });

    it("is inside early in the morning", () => {
      expect(inQuietHours(new Date("2026-01-01T03:00:00Z"), quiet)).toBe(true);
    });

    it("is outside during the day", () => {
      expect(inQuietHours(new Date("2026-01-01T12:00:00Z"), quiet)).toBe(false);
    });

    it("excludes the end minute", () => {
      expect(inQuietHours(new Date("2026-01-01T06:00:00Z"), quiet)).toBe(false);
    });
  });

  it("treats a zero-width window as never quiet", () => {
    expect(inQuietHours(NOW, { startMinute: 720, endMinute: 720 })).toBe(false);
  });
});

describe("routeNotification", () => {
  function channel(over: Partial<RoutingChannel> = {}): RoutingChannel {
    return { id: "ch1", tier: 0, enabled: true, verified: true, ...over };
  }

  it("sends to an enabled, verified, tier-0 channel", () => {
    const [decision] = routeNotification({
      kind: "OPENED",
      channels: [channel()],
      level: 0,
      now: NOW,
    });
    expect(decision!.send).toBe(true);
  });

  it("skips a disabled channel", () => {
    const [decision] = routeNotification({
      kind: "OPENED",
      channels: [channel({ enabled: false })],
      level: 0,
      now: NOW,
    });
    expect(decision!.send).toBe(false);
    expect(decision!.reason).toBe("channel disabled");
  });

  it("skips an unverified channel", () => {
    // Sending to an unconfirmed address turns Uptick into an open relay for
    // whoever typed it in.
    const [decision] = routeNotification({
      kind: "OPENED",
      channels: [channel({ verified: false })],
      level: 0,
      now: NOW,
    });
    expect(decision!.reason).toBe("channel not verified");
  });

  it("holds back a higher tier until escalation reaches it", () => {
    const decisions = routeNotification({
      kind: "OPENED",
      channels: [channel({ id: "a", tier: 0 }), channel({ id: "b", tier: 1 })],
      level: 0,
      now: NOW,
    });

    expect(decisions[0]!.send).toBe(true);
    expect(decisions[1]!.send).toBe(false);
    expect(decisions[1]!.reason).toBe("higher tier not yet reached");
  });

  it("includes a higher tier once escalation reaches it", () => {
    const decisions = routeNotification({
      kind: "ESCALATION",
      channels: [channel({ id: "a", tier: 0 }), channel({ id: "b", tier: 1 })],
      level: 1,
      now: NOW,
    });
    expect(decisions.every((d) => d.send)).toBe(true);
  });

  it("suppresses a page during quiet hours", () => {
    const quiet = { startMinute: 0, endMinute: 1439 };
    const [decision] = routeNotification({
      kind: "OPENED",
      channels: [channel({ quietHours: quiet })],
      level: 0,
      now: NOW,
    });
    expect(decision!.reason).toBe("quiet hours");
  });

  it("still delivers RESOLVED during quiet hours", () => {
    // Being told at 3am that something is fixed costs nothing. Being left
    // believing a service is still down until morning costs a great deal.
    const quiet = { startMinute: 0, endMinute: 1439 };
    const [decision] = routeNotification({
      kind: "RESOLVED",
      channels: [channel({ quietHours: quiet })],
      level: 0,
      now: NOW,
    });
    expect(decision!.send).toBe(true);
  });

  it("returns a decision for every channel, sent or not", () => {
    const decisions = routeNotification({
      kind: "OPENED",
      channels: [channel({ id: "a" }), channel({ id: "b", enabled: false })],
      level: 0,
      now: NOW,
    });
    expect(decisions.map((d) => d.channelId)).toEqual(["a", "b"]);
  });
});

describe("nextEscalationLevel", () => {
  const base = {
    openedAt: new Date("2026-01-01T12:00:00Z"),
    ackedAt: null,
    resolvedAt: null,
    currentLevel: 0,
    stepMinutes: 15,
    maxLevel: 3,
  };

  it("does not escalate before the step elapses", () => {
    const now = new Date("2026-01-01T12:14:00Z");
    expect(nextEscalationLevel({ ...base, now })).toBeNull();
  });

  it("escalates once the step elapses", () => {
    const now = new Date("2026-01-01T12:15:00Z");
    expect(nextEscalationLevel({ ...base, now })).toBe(1);
  });

  it("jumps straight to the earned tier after a long silence", () => {
    // A worker that was down for an hour must not walk up one tier per tick.
    const now = new Date("2026-01-01T13:00:00Z");
    expect(nextEscalationLevel({ ...base, now })).toBe(3);
  });

  it("never exceeds the maximum tier", () => {
    const now = new Date("2026-01-02T12:00:00Z");
    expect(nextEscalationLevel({ ...base, now })).toBe(3);
  });

  it("stops permanently once acknowledged", () => {
    // A human has taken it. Paging the next tier anyway is how an on-call
    // rotation stops trusting the tool.
    const now = new Date("2026-01-01T13:00:00Z");
    const acked = new Date("2026-01-01T12:05:00Z");
    expect(nextEscalationLevel({ ...base, ackedAt: acked, now })).toBeNull();
  });

  it("stops once resolved", () => {
    const now = new Date("2026-01-01T13:00:00Z");
    const resolved = new Date("2026-01-01T12:05:00Z");
    expect(nextEscalationLevel({ ...base, resolvedAt: resolved, now })).toBeNull();
  });

  it("does not repeat a tier already reached", () => {
    const now = new Date("2026-01-01T12:20:00Z");
    expect(nextEscalationLevel({ ...base, currentLevel: 1, now })).toBeNull();
  });

  it("is disabled by a non-positive step", () => {
    const now = new Date("2026-01-01T13:00:00Z");
    expect(nextEscalationLevel({ ...base, stepMinutes: 0, now })).toBeNull();
  });

  it("is disabled when already at the maximum", () => {
    const now = new Date("2026-01-01T20:00:00Z");
    expect(nextEscalationLevel({ ...base, currentLevel: 3, now })).toBeNull();
  });
});
