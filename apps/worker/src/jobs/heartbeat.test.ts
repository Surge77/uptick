import { describe, expect, it } from "vitest";
import { isHeartbeatStale, selectStale, type HeartbeatRecord } from "./heartbeat.js";

const NOW = new Date("2026-01-01T12:00:00Z");

function hb(over: Partial<HeartbeatRecord> = {}): HeartbeatRecord {
  return { monitorId: "m1", graceSec: 300, lastPingAt: NOW, ...over };
}

describe("isHeartbeatStale", () => {
  it("is not stale immediately after a ping", () => {
    expect(isHeartbeatStale(hb(), NOW)).toBe(false);
  });

  it("is not stale inside the grace period", () => {
    const pinged = new Date(NOW.getTime() - 299_000);
    expect(isHeartbeatStale(hb({ lastPingAt: pinged }), NOW)).toBe(false);
  });

  it("is not stale exactly on the deadline", () => {
    const pinged = new Date(NOW.getTime() - 300_000);
    expect(isHeartbeatStale(hb({ lastPingAt: pinged }), NOW)).toBe(false);
  });

  it("is stale one second past the deadline", () => {
    const pinged = new Date(NOW.getTime() - 301_000);
    expect(isHeartbeatStale(hb({ lastPingAt: pinged }), NOW)).toBe(true);
  });

  it("is NOT stale when it has never pinged", () => {
    // A nightly job registered five minutes ago has not had a chance to run.
    // Alerting here would page for a monitor that is merely new.
    const old = new Date(NOW.getTime() - 30 * 86_400_000);
    expect(isHeartbeatStale(hb({ lastPingAt: null }), old)).toBe(false);
    expect(isHeartbeatStale(hb({ lastPingAt: null }), NOW)).toBe(false);
  });

  it("honours each heartbeat's own grace period", () => {
    const pinged = new Date(NOW.getTime() - 3600_000);
    expect(isHeartbeatStale(hb({ lastPingAt: pinged, graceSec: 300 }), NOW)).toBe(true);
    expect(isHeartbeatStale(hb({ lastPingAt: pinged, graceSec: 7200 }), NOW)).toBe(false);
  });
});

describe("selectStale", () => {
  it("returns nothing for no records", () => {
    expect(selectStale([], NOW)).toEqual({ checked: 0, stale: [] });
  });

  it("reports how many were checked alongside the stale ones", () => {
    const result = selectStale(
      [
        hb({ monitorId: "fresh", lastPingAt: NOW }),
        hb({ monitorId: "silent", lastPingAt: new Date(NOW.getTime() - 3600_000) }),
        hb({ monitorId: "never", lastPingAt: null }),
      ],
      NOW,
    );

    expect(result.checked).toBe(3);
    expect(result.stale).toEqual(["silent"]);
  });
});
