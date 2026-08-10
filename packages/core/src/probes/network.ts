import { canonicalizeHost, checkResolvedIp } from "./ssrf.js";
import { EMPTY_TIMINGS, type ProbeResult, type Resolver } from "./types.js";

/**
 * TCP, DNS and TLS-expiry probes.
 *
 * Every I/O capability is injected, so these stay testable without opening a
 * socket. The Node adapters live in `apps/worker`, keeping this package free of
 * a runtime dependency.
 */

function fail(error: string, latencyMs = 0): ProbeResult {
  return { ...EMPTY_TIMINGS, ok: false, statusCode: null, latencyMs, error };
}

// ── TCP ──────────────────────────────────────────────────────

export interface TcpConnectResult {
  connectMs: number;
}

/**
 * ADAPTER CONTRACT: `pinnedAddresses` are the addresses the SSRF guard
 * validated for `host`. The connector MUST dial one of them and MUST NOT
 * resolve `host` again — a second lookup is answered by the target's own
 * nameserver, which is how rebinding turns a validated probe into a connection
 * to 127.0.0.1. `host` is still passed so TLS can send the right SNI name.
 */
export type TcpConnector = (
  host: string,
  port: number,
  timeoutMs: number,
  pinnedAddresses: readonly string[],
) => Promise<TcpConnectResult>;

export interface TcpProbeOptions {
  /** `host:port`. */
  target: string;
  timeoutMs: number;
}

export interface TcpProbeDeps {
  connect: TcpConnector;
  resolve: Resolver;
  now: () => number;
}

/** Split `host:port`, including the bracketed IPv6 form. */
export function parseHostPort(target: string): { host: string; port: number } | null {
  const bracketed = /^\[(.+)\]:(\d+)$/.exec(target.trim());
  if (bracketed) {
    const port = Number(bracketed[2]);
    return port > 0 && port <= 65535 ? { host: bracketed[1]!, port } : null;
  }

  const trimmed = target.trim();
  // A bare IPv6 address has many colons and no brackets. Splitting on the last
  // one yields a mangled host ("fe80:" from "fe80::1"), so the deny-list would
  // be consulted about a string the user never asked for.
  if ((trimmed.match(/:/g)?.length ?? 0) > 1) return null;

  const index = trimmed.lastIndexOf(":");
  if (index <= 0) return null;

  const host = trimmed.slice(0, index).trim();
  const port = Number(trimmed.slice(index + 1));
  if (host === "" || !Number.isInteger(port) || port <= 0 || port > 65535) return null;
  return { host, port };
}

export async function probeTcp(options: TcpProbeOptions, deps: TcpProbeDeps): Promise<ProbeResult> {
  const parsed = parseHostPort(options.target);
  if (!parsed) return fail(`Invalid target, expected host:port — got ${options.target}`);

  const started = deps.now();

  const host = await resolveAllowedHost(parsed.host, deps.resolve);
  if (!host.allowed) return fail(host.reason, deps.now() - started);

  try {
    const { connectMs } = await deps.connect(
      host.host,
      parsed.port,
      options.timeoutMs,
      host.addresses,
    );
    return {
      ...EMPTY_TIMINGS,
      ok: true,
      statusCode: null,
      latencyMs: deps.now() - started,
      connectMs,
      error: null,
    };
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error), deps.now() - started);
  }
}

export type HostVerdict =
  | { allowed: true; host: string; addresses: string[] }
  | { allowed: false; reason: string };

/**
 * Resolve a bare hostname, refuse it if any address is blocked, and return the
 * addresses a connector may dial.
 *
 * The same rule as the HTTP probe: a TCP monitor pointed at an internal
 * hostname is just as effective a port scanner as an HTTP one. The addresses
 * are returned rather than discarded so the connector never has to ask DNS a
 * second question — the second answer is the attacker's to choose.
 */
export async function resolveAllowedHost(host: string, resolve: Resolver): Promise<HostVerdict> {
  // Canonicalize first: 0177.0.0.1 and 2130706433 are loopback, and the raw
  // string form would otherwise be punted to DNS unchecked.
  const canonical = canonicalizeHost(host);
  if (canonical === "") return { allowed: false, reason: "Missing host" };

  const literal = checkResolvedIp(canonical);
  // An IP literal is its own pin: there is no name to rebind.
  if (literal.allowed) return { allowed: true, host: canonical, addresses: [canonical] };
  if (literal.kind === "denied") {
    return { allowed: false, reason: `Blocked address ${canonical} (${literal.reason})` };
  }

  let addresses: string[];
  try {
    addresses = await resolve(canonical);
  } catch (error) {
    return {
      allowed: false,
      reason: `DNS resolution failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  if (addresses.length === 0) {
    return { allowed: false, reason: `DNS resolution returned no addresses for ${canonical}` };
  }

  for (const address of addresses) {
    const verdict = checkResolvedIp(address);
    if (!verdict.allowed) {
      return { allowed: false, reason: describeBlocked(address, verdict.reason) };
    }
  }
  return { allowed: true, host: canonical, addresses };
}

/** `resolveAllowedHost` for callers that only need the refusal reason. */
export async function assertHostAllowed(host: string, resolve: Resolver): Promise<string | null> {
  const verdict = await resolveAllowedHost(host, resolve);
  return verdict.allowed ? null : verdict.reason;
}

/**
 * Name a blocked address without confirming internal topology.
 *
 * Echoing the resolved IP is good for debugging, but for link-local it tells an
 * attacker their metadata-endpoint probe reached the resolver.
 */
export function describeBlocked(address: string, reason: string): string {
  if (reason.includes("link-local")) return `Blocked address (${reason})`;
  return `Blocked address ${address} (${reason})`;
}

// ── DNS ──────────────────────────────────────────────────────

export type DnsRecordType = "A" | "AAAA" | "CNAME" | "MX" | "TXT" | "NS";

export type DnsLookup = (hostname: string, type: DnsRecordType) => Promise<string[]>;

export interface DnsProbeOptions {
  hostname: string;
  recordType: DnsRecordType;
  /** When set, at least one returned record must equal one of these. */
  expectedValues?: readonly string[];
}

export interface DnsProbeDeps {
  lookup: DnsLookup;
  resolve: Resolver;
  now: () => number;
}

export async function probeDns(options: DnsProbeOptions, deps: DnsProbeDeps): Promise<ProbeResult> {
  const started = deps.now();

  // A DNS monitor is an internal-name resolution oracle unless it is gated the
  // same way every other probe is. Without this, a user points a monitor at
  // vault.prod.svc.cluster.local and reads the A records straight out of the
  // incident cause - free internal network mapping.
  const blocked = await assertHostAllowed(options.hostname, deps.resolve);
  if (blocked) return fail(blocked, deps.now() - started);

  let records: string[];
  try {
    records = await deps.lookup(options.hostname, options.recordType);
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error), deps.now() - started);
  }

  const latencyMs = deps.now() - started;

  if (records.length === 0) {
    return fail(`No ${options.recordType} records for ${options.hostname}`, latencyMs);
  }

  if (options.expectedValues && options.expectedValues.length > 0) {
    const expected = new Set(options.expectedValues.map((v) => v.toLowerCase()));
    const matched = records.some((r) => expected.has(r.toLowerCase()));
    if (!matched) {
      return fail(
        `Expected one of [${options.expectedValues.join(", ")}], got [${records.join(", ")}]`,
        latencyMs,
      );
    }
  }

  return { ...EMPTY_TIMINGS, ok: true, statusCode: null, latencyMs, dnsMs: latencyMs, error: null };
}

// ── TLS certificate expiry ───────────────────────────────────

export interface CertificateFacts {
  validTo: Date;
  validFrom: Date;
  issuer: string | null;
  handshakeMs: number;
}

/** Same pinning contract as `TcpConnector`; SNI must still carry `host`. */
export type CertificateInspector = (
  host: string,
  port: number,
  timeoutMs: number,
  pinnedAddresses: readonly string[],
) => Promise<CertificateFacts>;

export interface SslProbeOptions {
  /** `host` or `host:port`; defaults to 443. */
  target: string;
  timeoutMs: number;
  /** Fail once the certificate expires within this many days. */
  warnWithinDays: number;
}

export interface SslProbeDeps {
  inspect: CertificateInspector;
  resolve: Resolver;
  now: () => number;
  /** Current time, injected so expiry tests need no real certificate. */
  clock: () => Date;
}

const MS_PER_DAY = 86_400_000;

export async function probeSsl(options: SslProbeOptions, deps: SslProbeDeps): Promise<ProbeResult> {
  const parsed = parseHostPort(options.target) ?? { host: options.target.trim(), port: 443 };
  if (parsed.host === "") return fail("Invalid target");

  const started = deps.now();

  const host = await resolveAllowedHost(parsed.host, deps.resolve);
  if (!host.allowed) return fail(host.reason, deps.now() - started);

  let cert: CertificateFacts;
  try {
    cert = await deps.inspect(host.host, parsed.port, options.timeoutMs, host.addresses);
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error), deps.now() - started);
  }

  const latencyMs = deps.now() - started;
  const now = deps.clock();
  const base = {
    ...EMPTY_TIMINGS,
    statusCode: null,
    latencyMs,
    tlsMs: cert.handshakeMs,
  };

  if (now < cert.validFrom) {
    return { ...base, ok: false, error: `Certificate not valid until ${iso(cert.validFrom)}` };
  }

  const remainingMs = cert.validTo.getTime() - now.getTime();
  if (remainingMs <= 0) {
    return { ...base, ok: false, error: `Certificate expired on ${iso(cert.validTo)}` };
  }

  const remainingDays = Math.floor(remainingMs / MS_PER_DAY);
  if (remainingDays < options.warnWithinDays) {
    return {
      ...base,
      ok: false,
      error: `Certificate expires in ${remainingDays} day(s), threshold ${options.warnWithinDays}`,
    };
  }

  return { ...base, ok: true, error: null };
}

function iso(date: Date): string {
  return date.toISOString().slice(0, 10);
}
