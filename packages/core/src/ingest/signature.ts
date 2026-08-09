import { createHmac, timingSafeEqual } from "node:crypto";
import { minutes } from "../time.js";

/** Replay tolerance. A signature older than this is refused even if valid. */
export const DEFAULT_TOLERANCE_MS = minutes(5);

export type SignatureVerdict =
  | { valid: true }
  | { valid: false; reason: "malformed" | "stale" | "mismatch" | "no-secret" };

export interface VerifyInput {
  /** Raw request body, byte-for-byte as received. */
  payload: string;
  /** Signature header, formatted `t=<unix-seconds>,v1=<hex>`. */
  header: string;
  secret: string;
  now: Date;
  toleranceMs?: number;
}

interface ParsedHeader {
  timestamp: number;
  signature: string;
}

function parseHeader(header: string): ParsedHeader | null {
  let timestamp: number | null = null;
  let signature: string | null = null;

  for (const part of header.split(",")) {
    const [key, value] = part.trim().split("=", 2);
    if (!key || !value) continue;
    if (key === "t") {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) timestamp = parsed;
    }
    if (key === "v1") {
      signature = value;
    }
  }

  if (timestamp === null || signature === null) return null;
  return { timestamp, signature };
}

/**
 * Verify an inbound deploy webhook.
 *
 * The timestamp is part of the signed payload, not merely a field beside it,
 * so an attacker cannot replay a captured body with a fresh timestamp — doing
 * so invalidates the signature. The tolerance window then bounds how long a
 * captured request stays usable at all.
 *
 * Comparison is timing-safe. A byte-by-byte early exit leaks how much of a
 * guessed signature was correct, which is enough to forge one a byte at a time.
 */
export function verifyWebhookSignature(input: VerifyInput): SignatureVerdict {
  if (input.secret === "") {
    // An empty secret would otherwise verify a predictable HMAC, turning the
    // endpoint into an open write. Refuse rather than accept.
    return { valid: false, reason: "no-secret" };
  }

  const parsed = parseHeader(input.header);
  if (!parsed) {
    return { valid: false, reason: "malformed" };
  }

  const tolerance = input.toleranceMs ?? DEFAULT_TOLERANCE_MS;
  const ageMs = Math.abs(input.now.getTime() - parsed.timestamp * 1000);
  if (ageMs > tolerance) {
    return { valid: false, reason: "stale" };
  }

  const expected = signPayload(input.payload, parsed.timestamp, input.secret);
  return constantTimeEquals(expected, parsed.signature)
    ? { valid: true }
    : { valid: false, reason: "mismatch" };
}

/** The signature a sender should produce. Exported so senders can be tested. */
export function signPayload(payload: string, timestampSeconds: number, secret: string): string {
  return createHmac("sha256", secret).update(`${timestampSeconds}.${payload}`).digest("hex");
}

/** Build the full header value for a payload. */
export function buildSignatureHeader(payload: string, now: Date, secret: string): string {
  const timestamp = Math.floor(now.getTime() / 1000);
  return `t=${timestamp},v1=${signPayload(payload, timestamp, secret)}`;
}

function constantTimeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  // timingSafeEqual throws on length mismatch, which would itself be a leak;
  // the length check is cheap and reveals only what the header already shows.
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
