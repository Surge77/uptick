import { evaluateAssertions, summarizeFailures } from "./assertions.js";
import { checkResolvedIp, checkUrl } from "./ssrf.js";
import {
  CROSS_ORIGIN_STRIPPED_HEADERS,
  EMPTY_TIMINGS,
  MAX_BODY_BYTES,
  MAX_REDIRECTS,
  REDIRECT_STATUSES,
  type HttpAssertions,
  type HttpTransport,
  type ProbeResult,
  type Resolver,
} from "./types.js";

export interface HttpProbeOptions {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string | undefined;
  timeoutMs: number;
  assertions?: HttpAssertions;
  maxRedirects?: number;
}

export interface HttpProbeDeps {
  transport: HttpTransport;
  resolve: Resolver;
  /** Injected clock, in milliseconds. Defaults to `Date.now` at the call site. */
  now: () => number;
}

function fail(error: string, latencyMs: number): ProbeResult {
  return { ...EMPTY_TIMINGS, ok: false, statusCode: null, latencyMs, error };
}

export type TargetVerdict =
  | { allowed: true; hostname: string; addresses: string[] }
  | { allowed: false; reason: string };

/**
 * Validate a URL structurally, then validate every address it resolves to, and
 * return those addresses so the caller can connect to them.
 *
 * Two properties, both load-bearing:
 *  - ALL resolved addresses must pass, not merely one. A hostname with an A
 *    record for a public address and another for 127.0.0.1 would otherwise be
 *    reachable whenever the resolver happened to return the private one first.
 *  - The addresses come back to the caller. Returning only a boolean forces the
 *    transport to resolve the name a second time, and the answer to that second
 *    query is under the attacker's control — which is the rebinding bypass.
 */
export async function resolveAllowedTarget(url: string, resolve: Resolver): Promise<TargetVerdict> {
  const structural = checkUrl(url);
  if (!structural.allowed) return { allowed: false, reason: structural.reason };

  let addresses: string[];
  try {
    addresses = await resolve(structural.hostname);
  } catch (error) {
    return {
      allowed: false,
      reason: `DNS resolution failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  if (addresses.length === 0) {
    return {
      allowed: false,
      reason: `DNS resolution returned no addresses for ${structural.hostname}`,
    };
  }

  for (const address of addresses) {
    const verdict = checkResolvedIp(address);
    if (!verdict.allowed) {
      return { allowed: false, reason: `Blocked address ${address} (${verdict.reason})` };
    }
  }

  return { allowed: true, hostname: structural.hostname, addresses };
}

/** `resolveAllowedTarget` for callers that only need the refusal reason. */
export async function assertTargetAllowed(url: string, resolve: Resolver): Promise<string | null> {
  const verdict = await resolveAllowedTarget(url, resolve);
  return verdict.allowed ? null : verdict.reason;
}

/**
 * Execute an HTTP probe, following redirects with a full security re-check on
 * every hop.
 *
 * Re-validating each hop is not defensive duplication: validating only the
 * first URL is a complete bypass, because a target the attacker controls can
 * answer with `302 Location: http://169.254.169.254/`.
 */
export async function probeHttp(
  options: HttpProbeOptions,
  deps: HttpProbeDeps,
): Promise<ProbeResult> {
  const { transport, resolve, now } = deps;
  const started = now();
  const maxRedirects = options.maxRedirects ?? MAX_REDIRECTS;

  let currentUrl = options.url;
  let headers = options.headers ?? {};
  let method = options.method ?? "GET";
  let body = options.body;
  let redirects = 0;

  while (true) {
    const target = await resolveAllowedTarget(currentUrl, resolve);
    if (!target.allowed) return fail(target.reason, now() - started);

    let exchange;
    try {
      exchange = await transport({
        url: currentUrl,
        method,
        headers,
        body,
        timeoutMs: options.timeoutMs,
        // Pinned per hop, not per probe: hop 2 is a different host and must be
        // dialled at ITS validated addresses, never hop 1's.
        pinnedAddresses: target.addresses,
      });
    } catch (error) {
      return fail(error instanceof Error ? error.message : String(error), now() - started);
    }

    if (REDIRECT_STATUSES.has(exchange.status) && exchange.location) {
      redirects += 1;
      if (redirects > maxRedirects) {
        return fail(`Too many redirects (limit ${maxRedirects})`, now() - started);
      }

      let next: URL;
      let current: URL;
      try {
        current = new URL(currentUrl);
        next = new URL(exchange.location, currentUrl);
      } catch {
        return fail(`Invalid redirect location: ${exchange.location}`, now() - started);
      }

      // Never downgrade. A monitored host that redirects https to http would
      // otherwise get the request replayed in plaintext.
      if (current.protocol === "https:" && next.protocol === "http:") {
        return fail(`Refused redirect downgrade to http: ${next.origin}`, now() - started);
      }

      if (next.origin !== current.origin) {
        headers = stripSensitiveHeaders(headers);
      }

      // RFC 9110: a 303 must be re-issued as GET with no body. Preserving the
      // method replays a user's POST body at the redirect target.
      if (exchange.status === 303 && method !== "GET" && method !== "HEAD") {
        method = "GET";
        body = undefined;
      }

      currentUrl = next.toString();
      continue;
    }

    const latencyMs = now() - started;
    const failures = evaluateAssertions(
      {
        statusCode: exchange.status,
        headers: normalizeHeaders(exchange.headers),
        body: truncateBody(exchange.body),
        latencyMs,
      },
      options.assertions ?? {},
    );

    return {
      ok: failures.length === 0,
      statusCode: exchange.status,
      latencyMs,
      error: summarizeFailures(failures),
      dnsMs: exchange.timings?.dnsMs ?? null,
      connectMs: exchange.timings?.connectMs ?? null,
      tlsMs: exchange.timings?.tlsMs ?? null,
      ttfbMs: exchange.timings?.ttfbMs ?? null,
    };
  }
}

/**
 * Drop credential-bearing headers before following a cross-origin redirect.
 *
 * A monitor legitimately carries an Authorization header for the host it
 * watches. An open redirect on that host would otherwise hand the production
 * token to whatever origin it points at.
 */
export function stripSensitiveHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (!CROSS_ORIGIN_STRIPPED_HEADERS.includes(key.toLowerCase())) out[key] = value;
  }
  return out;
}

/**
 * Defence in depth only. The transport contract requires the body to be capped
 * while streaming; by the time a string reaches here the memory is already
 * allocated, so this bounds the assertion work rather than the allocation.
 */
export function truncateBody(body: string): string {
  return body.length > MAX_BODY_BYTES ? body.slice(0, MAX_BODY_BYTES) : body;
}

/** Lower-case header names so assertions can compare case-insensitively. */
function normalizeHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    out[key.toLowerCase()] = value;
  }
  return out;
}
