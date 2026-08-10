/** Shared probe contracts. */

export type ProbeType = "HTTP" | "TCP" | "SSL" | "DNS";

/** Per-phase timing breakdown, so a slowdown can be attributed. */
export interface PhaseTimings {
  dnsMs: number | null;
  connectMs: number | null;
  tlsMs: number | null;
  ttfbMs: number | null;
}

export const EMPTY_TIMINGS: PhaseTimings = {
  dnsMs: null,
  connectMs: null,
  tlsMs: null,
  ttfbMs: null,
};

export interface ProbeResult extends PhaseTimings {
  ok: boolean;
  statusCode: number | null;
  latencyMs: number;
  error: string | null;
}

/** Assertions evaluated against an HTTP response. All must hold for `ok`. */
export interface HttpAssertions {
  /** Exact status, or a class like `2xx`. Defaults to `2xx` when omitted. */
  expectedStatus?: number | string;
  bodyContains?: string;
  bodyNotContains?: string;
  /** Anchored with `new RegExp(...)`; supplied by the monitor's owner. */
  bodyMatches?: string;
  /** Dot path into a JSON body, e.g. `data.status`. */
  jsonPath?: string;
  jsonEquals?: string | number | boolean | null;
  headerEquals?: Record<string, string>;
  /** Fail if the response took longer than this, independent of timeout. */
  maxLatencyMs?: number;
}

/** The subset of a response the assertion evaluator needs. */
export interface ResponseFacts {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
  latencyMs: number;
}

/**
 * Resolves a hostname to IP addresses. Injected so probes stay testable.
 *
 * ADAPTER CONTRACT - the security of every probe depends on this:
 *  - MUST return EVERY address the connection layer could pick, both A and
 *    AAAA. An adapter built on `dns.resolve4` alone leaves AAAA unchecked, and
 *    a dual-stack host whose AAAA is `::1` would then be reached.
 *  - MUST use `dns.lookup(host, { all: true, verbatim: true })` semantics, so
 *    it consults the same sources (`/etc/hosts`, nsswitch, search domains) the
 *    real connect path does. `dns.resolve*` bypasses them and can disagree.
 *  - MUST reject rather than return an empty array on failure.
 */
export type Resolver = (hostname: string) => Promise<string[]>;

/** Minimal fetch-like port, so the HTTP probe never imports a real client. */
export interface HttpExchange {
  status: number;
  headers: Record<string, string>;
  body: string;
  /** Set when the response is a redirect the caller must follow. */
  location?: string | null;
  timings?: Partial<PhaseTimings>;
}

export interface HttpRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string | undefined;
  timeoutMs: number;
  /**
   * Every address the SSRF guard validated for THIS url, on this hop. Non-empty
   * whenever the guard allowed the request; see the transport contract below.
   */
  pinnedAddresses: readonly string[];
}

/**
 * ADAPTER CONTRACT - violating any clause silently defeats this module:
 *  - MUST NOT follow redirects itself (`redirect: "manual"`). If the transport
 *    follows them internally, `probeHttp` never sees hop 2 and the per-hop
 *    SSRF re-check is bypassed completely, while every injected-fake test
 *    still passes.
 *  - MUST stop reading the body at `MAX_BODY_BYTES` and abort the stream.
 *    Truncating after the fact is too late; the memory is already allocated.
 *  - MUST connect to one of `pinnedAddresses` and MUST NOT resolve the
 *    hostname again. Re-resolving reopens DNS rebinding: the guard validated
 *    the answer to one query, and a hostile nameserver is free to answer the
 *    second one with 169.254.169.254. An empty list MUST be refused rather
 *    than resolved, because empty means nothing was ever validated.
 */
export type HttpTransport = (request: HttpRequest) => Promise<HttpExchange>;

export const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/** Redirect chains are capped: a loop must fail rather than spin. */
export const MAX_REDIRECTS = 5;

/** Response bodies are truncated to bound memory on a hostile target. */
export const MAX_BODY_BYTES = 512 * 1024;

/**
 * Headers stripped when a redirect crosses to a different origin.
 *
 * A monitor legitimately carries an Authorization header; an open redirect on
 * the monitored host would otherwise replay that credential to the redirect
 * target.
 */
export const CROSS_ORIGIN_STRIPPED_HEADERS = ["authorization", "cookie", "proxy-authorization"];
