import { describe, expect, it } from "vitest";
import { buildSignatureHeader, signPayload, verifyWebhookSignature } from "./signature.js";
import { minutes } from "../time.js";

const SECRET = "test-secret";
const NOW = new Date("2026-01-01T12:00:00Z");
const PAYLOAD = JSON.stringify({ org: "acme", label: "deploy abc123" });

const verify = (overrides: Partial<Parameters<typeof verifyWebhookSignature>[0]> = {}) =>
  verifyWebhookSignature({
    payload: PAYLOAD,
    header: buildSignatureHeader(PAYLOAD, NOW, SECRET),
    secret: SECRET,
    now: NOW,
    ...overrides,
  });

describe("verifyWebhookSignature", () => {
  it("accepts a correctly signed payload", () => {
    expect(verify()).toEqual({ valid: true });
  });

  it("rejects a payload modified after signing", () => {
    expect(verify({ payload: JSON.stringify({ org: "evil", label: "x" }) })).toEqual({
      valid: false,
      reason: "mismatch",
    });
  });

  it("rejects a signature made with the wrong secret", () => {
    expect(verify({ header: buildSignatureHeader(PAYLOAD, NOW, "other-secret") })).toEqual({
      valid: false,
      reason: "mismatch",
    });
  });

  it("rejects a replayed request outside the tolerance window", () => {
    const later = new Date(NOW.getTime() + minutes(10));
    expect(verify({ now: later })).toEqual({ valid: false, reason: "stale" });
  });

  it("accepts a request inside the tolerance window", () => {
    const soon = new Date(NOW.getTime() + minutes(2));
    expect(verify({ now: soon })).toEqual({ valid: true });
  });

  it("rejects a timestamp too far in the future", () => {
    const earlier = new Date(NOW.getTime() - minutes(10));
    expect(verify({ now: earlier })).toEqual({ valid: false, reason: "stale" });
  });

  it("rejects a captured signature paired with a fresh timestamp", () => {
    // The timestamp is inside the signed payload, so swapping it invalidates
    // the signature rather than extending its life.
    const captured = signPayload(PAYLOAD, Math.floor(NOW.getTime() / 1000), SECRET);
    const freshTimestamp = Math.floor((NOW.getTime() + minutes(4)) / 1000);
    const forged = `t=${freshTimestamp},v1=${captured}`;

    expect(verify({ header: forged, now: new Date(NOW.getTime() + minutes(4)) })).toEqual({
      valid: false,
      reason: "mismatch",
    });
  });

  it("rejects malformed headers", () => {
    for (const header of ["", "garbage", "t=123", "v1=abc", "t=notanumber,v1=abc"]) {
      expect(verify({ header }).valid).toBe(false);
    }
  });

  it("refuses to verify when no secret is configured", () => {
    expect(verify({ secret: "" })).toEqual({ valid: false, reason: "no-secret" });
  });

  it("rejects a signature of the wrong length without throwing", () => {
    expect(verify({ header: `t=${Math.floor(NOW.getTime() / 1000)},v1=abcd` })).toEqual({
      valid: false,
      reason: "mismatch",
    });
  });
});
