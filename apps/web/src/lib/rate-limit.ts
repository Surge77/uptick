/**
 * Sliding-window rate limiter with two backends and no dependencies.
 *
 * The pure window arithmetic lives in `slideWindow` so it can be unit tested.
 * Storage is pluggable: an in-process Map by default, or Upstash Redis over
 * plain REST when UPSTASH_REDIS_REST_URL/TOKEN are set — the full client SDK
 * would add a dependency for what is one POST request.
 *
 * The in-memory backend is per-instance: two serverless instances each allow
 * their own quota. Acceptable for the launch threat model (blunting abuse,
 * not billing enforcement); Upstash makes it global when configured.
 */

export interface WindowState {
  /** Start of the current fixed window, ms epoch. */
  windowStart: number;
  /** Requests seen in the current window. */
  current: number;
  /** Requests seen in the previous window, for the sliding weight. */
  previous: number;
}

export interface SlideResult {
  allowed: boolean;
  /** Weighted request count the decision was based on. */
  count: number;
  state: WindowState;
}

/**
 * Advance a window state to `now` and count one request against `limit`.
 *
 * Sliding window rather than fixed: a fixed window admits a full burst at
 * 59.9s and another at 60.1s — double the intended rate across a boundary.
 * Weighting the previous window by its remaining overlap removes that edge
 * without storing per-request timestamps.
 */
export function slideWindow(
  state: WindowState | undefined,
  now: number,
  limit: number,
  windowMs: number,
): SlideResult {
  let s: WindowState;

  if (!state || now - state.windowStart >= windowMs * 2) {
    // Fresh key, or idle long enough that both windows expired.
    s = { windowStart: now, current: 0, previous: 0 };
  } else if (now - state.windowStart >= windowMs) {
    // Rolled into the next window: current becomes previous.
    s = { windowStart: state.windowStart + windowMs, current: 0, previous: state.current };
    // If more than one whole window elapsed, the old counts are stale.
    if (now - s.windowStart >= windowMs) {
      s = { windowStart: now, current: 0, previous: 0 };
    }
  } else {
    s = { ...state };
  }

  const elapsed = (now - s.windowStart) / windowMs;
  const weighted = s.previous * (1 - elapsed) + s.current;

  if (weighted >= limit) {
    return { allowed: false, count: weighted, state: s };
  }

  s.current += 1;
  return { allowed: true, count: weighted + 1, state: s };
}

// ── Backends ─────────────────────────────────────────────────

const MAX_KEYS = 10_000;

const memory = new Map<string, WindowState>();

function limitInMemory(key: string, now: number, limit: number, windowMs: number): boolean {
  // Bound the map so a key-spraying client cannot grow it without limit;
  // evicting the oldest insertion is enough at this size.
  if (memory.size >= MAX_KEYS && !memory.has(key)) {
    const oldest = memory.keys().next().value;
    if (oldest !== undefined) memory.delete(oldest);
  }

  const result = slideWindow(memory.get(key), now, limit, windowMs);
  memory.set(key, result.state);
  return result.allowed;
}

/** Exposed for tests only. */
export function resetMemoryLimiter(): void {
  memory.clear();
}

async function limitUpstash(
  key: string,
  limit: number,
  windowMs: number,
  url: string,
  token: string,
): Promise<boolean> {
  // Fixed window on Redis: INCR the bucket for this window and expire it.
  // Cruder than the in-memory slide, but shared across instances, and one
  // round trip. Pipeline keeps it a single request.
  const bucket = `rl:${key}:${Math.floor(Date.now() / windowMs)}`;
  const ttlSec = Math.ceil((windowMs * 2) / 1000);

  const response = await fetch(`${url}/pipeline`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify([
      ["INCR", bucket],
      ["EXPIRE", bucket, String(ttlSec)],
    ]),
    signal: AbortSignal.timeout(2000),
  });

  if (!response.ok) {
    throw new Error(`rate limit backend returned ${response.status}`);
  }

  const rows = (await response.json()) as { result?: number }[];
  const count = rows[0]?.result ?? 0;
  return count <= limit;
}

/**
 * Decide whether `key` may proceed.
 *
 * Fails open: if the Redis call errors, the request is allowed. This guards
 * a public write endpoint that already requires an HMAC signature — dropping
 * legitimate deploy markers because Redis blipped would be a worse failure
 * than briefly losing the rate cap.
 */
export async function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number,
): Promise<boolean> {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (url && token) {
    try {
      return await limitUpstash(key, limit, windowMs, url, token);
    } catch {
      return true;
    }
  }

  return limitInMemory(key, Date.now(), limit, windowMs);
}
