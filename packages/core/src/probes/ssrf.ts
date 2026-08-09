/**
 * SSRF protection for user-supplied probe and webhook targets.
 *
 * Uptick's entire purpose is making outbound requests to addresses its users
 * choose, which makes server-side request forgery the highest-severity risk in
 * this codebase. Three rules must hold, and each closes a bypass that defeats
 * the other two on its own:
 *
 *  1. Validate the RESOLVED IP, never the hostname string. An attacker controls
 *     their own DNS and can point any name at 169.254.169.254.
 *  2. Re-validate on EVERY redirect hop. A public first hop that redirects to
 *     an internal address is a complete bypass of a first-request-only check.
 *  3. Decode IPv4-mapped IPv6 before matching. `::ffff:127.0.0.1` is loopback
 *     wearing a v6 costume and matches no v6 deny range.
 *
 * Residual risk: DNS rebinding, where a name resolves to a public address at
 * validation time and a private one at connection time. Closing it requires
 * pinning the validated IP for the connection itself; see `PINNING_TODO` below.
 */

export type IpVersion = 4 | 6;

export interface ParsedIp {
  version: IpVersion;
  /** Canonical bytes: 4 for IPv4, 16 for IPv6. */
  bytes: number[];
}

export interface BlockedRange {
  cidr: string;
  reason: string;
}

interface CompiledRange extends BlockedRange {
  version: IpVersion;
  bytes: number[];
  prefixLength: number;
}

/**
 * IPv4 ranges that must never be probed.
 *
 * 169.254.0.0/16 is listed first because it contains the cloud metadata
 * endpoint (169.254.169.254) that turns an SSRF into credential theft on AWS,
 * GCP and Azure alike. It is the single highest-value target here.
 */
export const BLOCKED_IPV4: readonly BlockedRange[] = [
  { cidr: "169.254.0.0/16", reason: "link-local (cloud metadata endpoint)" },
  { cidr: "127.0.0.0/8", reason: "loopback" },
  { cidr: "10.0.0.0/8", reason: "private" },
  { cidr: "172.16.0.0/12", reason: "private" },
  { cidr: "192.168.0.0/16", reason: "private" },
  { cidr: "0.0.0.0/8", reason: "unspecified / this network" },
  { cidr: "100.64.0.0/10", reason: "carrier-grade NAT" },
  { cidr: "192.0.0.0/24", reason: "IETF protocol assignments" },
  { cidr: "192.0.2.0/24", reason: "documentation (TEST-NET-1)" },
  { cidr: "198.18.0.0/15", reason: "benchmarking" },
  { cidr: "198.51.100.0/24", reason: "documentation (TEST-NET-2)" },
  { cidr: "203.0.113.0/24", reason: "documentation (TEST-NET-3)" },
  { cidr: "224.0.0.0/4", reason: "multicast" },
  { cidr: "240.0.0.0/4", reason: "reserved" },
  { cidr: "192.88.99.0/24", reason: "6to4 relay anycast" },
];

export const BLOCKED_IPV6: readonly BlockedRange[] = [
  { cidr: "::/128", reason: "unspecified" },
  { cidr: "::1/128", reason: "loopback" },
  { cidr: "fc00::/7", reason: "unique local" },
  { cidr: "fe80::/10", reason: "link-local" },
  { cidr: "ff00::/8", reason: "multicast" },
  { cidr: "64:ff9b::/96", reason: "NAT64 translation" },
  { cidr: "100::/64", reason: "discard-only" },
  { cidr: "2001:db8::/32", reason: "documentation" },
  { cidr: "2002::/16", reason: "6to4 (can encapsulate any IPv4 address)" },
  { cidr: "2001::/32", reason: "Teredo tunnelling" },
  { cidr: "fec0::/10", reason: "deprecated site-local" },
  { cidr: "::ffff:0:0:0/96", reason: "IPv4-translated (SIIT)" },
  { cidr: "2001:20::/28", reason: "ORCHIDv2" },
];

/** Protocols a probe may speak. Everything else (file:, gopher:) is refused. */
export const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);

/** Parse a dotted-quad IPv4 address in strict canonical form. */
function parseIpv4(input: string): ParsedIp | null {
  const parts = input.split(".");
  if (parts.length !== 4) return null;

  const bytes: number[] = [];
  for (const part of parts) {
    // Reject anything non-canonical. Octal (0177.0.0.1) and zero-padded forms
    // are interpreted differently by different resolvers, which is exactly the
    // kind of ambiguity a deny-list cannot afford.
    if (!/^\d{1,3}$/.test(part)) return null;
    if (part.length > 1 && part.startsWith("0")) return null;
    const value = Number(part);
    if (value > 255) return null;
    bytes.push(value);
  }
  return { version: 4, bytes };
}

/** Parse an IPv6 address, including the IPv4-mapped and compressed forms. */
function parseIpv6(input: string): ParsedIp | null {
  let text = input;

  // Strip a zone index (fe80::1%eth0); it carries no addressing information.
  const zone = text.indexOf("%");
  if (zone !== -1) text = text.slice(0, zone);

  if (!text.includes(":")) return null;

  // An embedded IPv4 tail (::ffff:127.0.0.1) is rewritten to hex groups so the
  // whole address can be matched uniformly. Skipping this step is the classic
  // loopback bypass.
  let tail: number[] | null = null;
  const lastColon = text.lastIndexOf(":");
  const suffix = text.slice(lastColon + 1);
  if (suffix.includes(".")) {
    const v4 = parseIpv4(suffix);
    if (!v4) return null;
    tail = v4.bytes;
    text = text.slice(0, lastColon + 1) + "0:0";
  }

  const halves = text.split("::");
  if (halves.length > 2) return null;

  const expand = (segment: string): number[] | null => {
    if (segment === "") return [];
    const groups = segment.split(":");
    const out: number[] = [];
    for (const group of groups) {
      if (!/^[0-9a-fA-F]{1,4}$/.test(group)) return null;
      const value = Number.parseInt(group, 16);
      out.push((value >> 8) & 0xff, value & 0xff);
    }
    return out;
  };

  const head = expand(halves[0] ?? "");
  const rest = halves.length === 2 ? expand(halves[1] ?? "") : null;
  if (head === null) return null;
  if (halves.length === 2 && rest === null) return null;

  let bytes: number[];
  if (halves.length === 2) {
    const fill = 16 - head.length - rest!.length;
    // "::" must elide at least one group. Accepting a zero-width elision makes
    // the parser diverge from net.isIP, and parser/resolver disagreement is
    // the shape every SSRF bypass takes.
    if (fill <= 0) return null;
    bytes = [...head, ...new Array<number>(fill).fill(0), ...rest!];
  } else {
    bytes = head;
  }

  if (bytes.length !== 16) return null;
  if (tail) bytes.splice(12, 4, ...tail);

  return { version: 6, bytes };
}

/** Parse an IP address into canonical bytes, or null if it is not an IP. */
export function parseIp(input: string): ParsedIp | null {
  const trimmed = input.trim().replace(/^\[|\]$/g, "");
  return parseIpv4(trimmed) ?? parseIpv6(trimmed);
}

/**
 * Unwrap an IPv4-mapped or IPv4-compatible IPv6 address to its IPv4 form.
 *
 * `::ffff:169.254.169.254` must be evaluated against the IPv4 deny-list, not
 * the IPv6 one, or the metadata endpoint is reachable through a v6 literal.
 */
export function unwrapMappedIpv4(ip: ParsedIp): ParsedIp {
  if (ip.version !== 6) return ip;

  const prefix = ip.bytes.slice(0, 10);
  if (prefix.some((b) => b !== 0)) return ip;

  const marker = ip.bytes.slice(10, 12);
  const isMapped = marker[0] === 0xff && marker[1] === 0xff;
  const isCompatible = marker[0] === 0 && marker[1] === 0;
  if (!isMapped && !isCompatible) return ip;

  const tail = ip.bytes.slice(12, 16);
  // ::0.0.0.0 and ::1 are handled by the IPv6 deny-list; do not misread them
  // as IPv4 addresses.
  if (isCompatible && tail.every((b) => b === 0)) return ip;
  if (isCompatible && tail[0] === 0 && tail[1] === 0 && tail[2] === 0 && tail[3] === 1) return ip;

  return { version: 4, bytes: tail };
}

function compile(ranges: readonly BlockedRange[], version: IpVersion): CompiledRange[] {
  return ranges.map((range) => {
    const [address, prefix] = range.cidr.split("/");
    const parsed = parseIp(address!);
    if (!parsed) throw new Error(`Invalid CIDR in deny-list: ${range.cidr}`);
    return { ...range, version, bytes: parsed.bytes, prefixLength: Number(prefix) };
  });
}

const COMPILED: readonly CompiledRange[] = [
  ...compile(BLOCKED_IPV4, 4),
  ...compile(BLOCKED_IPV6, 6),
];

/** Whether an address falls inside a CIDR range, compared bit by bit. */
function inRange(ip: ParsedIp, range: CompiledRange): boolean {
  if (ip.version !== range.version) return false;

  const fullBytes = Math.floor(range.prefixLength / 8);
  const remainingBits = range.prefixLength % 8;

  for (let i = 0; i < fullBytes; i += 1) {
    if (ip.bytes[i] !== range.bytes[i]) return false;
  }

  if (remainingBits === 0) return true;

  const mask = (0xff << (8 - remainingBits)) & 0xff;
  return (ip.bytes[fullBytes]! & mask) === (range.bytes[fullBytes]! & mask);
}

export type IpVerdict =
  | { allowed: true }
  /**
   * `unparseable` means "not an IP at all", so a caller may resolve it as a
   * hostname. `denied` means it IS an IP and is forbidden. Callers must switch
   * on this discriminant rather than pattern-matching the readable reason.
   */
  | { allowed: false; kind: "unparseable" | "denied"; reason: string; cidr?: string };

/**
 * Decide whether an already-resolved IP address may be contacted.
 *
 * Deny by default: an address that cannot be parsed is refused rather than
 * assumed public, because an unparseable address means the deny-list was not
 * actually applied to anything.
 */
export function checkResolvedIp(address: string): IpVerdict {
  const parsed = parseIp(address);
  if (!parsed) {
    return {
      allowed: false,
      kind: "unparseable",
      reason: `Not a valid IP address: ${address}`,
    };
  }

  const effective = unwrapMappedIpv4(parsed);

  for (const range of COMPILED) {
    if (inRange(effective, range)) {
      return { allowed: false, kind: "denied", reason: range.reason, cidr: range.cidr };
    }
  }

  // 255.255.255.255 is inside 240.0.0.0/4 and already caught above; this guard
  // documents the intent rather than adding coverage.
  return { allowed: true };
}

export type UrlVerdict =
  | { allowed: true; hostname: string; port: number | null }
  | { allowed: false; reason: string };

/**
 * Structural validation of a target URL, before any DNS resolution.
 *
 * This is a cheap pre-filter, NOT the security boundary. A hostname that passes
 * here must still have every resolved IP checked with `checkResolvedIp`.
 */
export function checkUrl(raw: string): UrlVerdict {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { allowed: false, reason: "Malformed URL" };
  }

  if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
    return { allowed: false, reason: `Protocol not allowed: ${url.protocol}` };
  }

  if (url.username || url.password) {
    // Embedded credentials would otherwise be written to logs and incident
    // causes verbatim.
    return { allowed: false, reason: "Credentials in URL are not allowed" };
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (hostname === "") {
    return { allowed: false, reason: "Missing hostname" };
  }

  // A literal IP can be judged immediately; a name must wait for resolution.
  const literal = parseIp(hostname);
  if (literal) {
    const verdict = checkResolvedIp(hostname);
    if (!verdict.allowed) {
      return { allowed: false, reason: `Blocked address (${verdict.reason})` };
    }
  }

  const port = url.port === "" ? null : Number(url.port);
  return { allowed: true, hostname, port };
}

/**
 * Canonicalize a bare hostname or IP literal the way WHATWG URL parsing would.
 *
 * The HTTP path gets this for free from `new URL()`, which rewrites octal,
 * decimal and hex IPv4 forms (`0177.0.0.1`, `2130706433`, `127.1`) to dotted
 * quad before any check runs. TCP and TLS targets are raw strings with no URL
 * involved, so without this they reach the deny-list in a form the parser
 * deliberately refuses and get punted to DNS - a bypass waiting for a lenient
 * resolver.
 */
export function canonicalizeHost(host: string): string {
  const trimmed = host.trim().replace(/^\[|\]$/g, "");
  if (trimmed === "") return trimmed;
  if (parseIp(trimmed)) return trimmed;
  try {
    const bracketed = trimmed.includes(":") ? `[${trimmed}]` : trimmed;
    return new URL(`http://${bracketed}`).hostname.replace(/^\[|\]$/g, "");
  } catch {
    return trimmed;
  }
}

/**
 * Known-unclosed gap, tracked deliberately rather than left implicit.
 *
 * Between `checkResolvedIp` succeeding and the socket connecting, a hostile
 * DNS server can change the answer (rebinding). The fix is to connect to the
 * validated IP directly while sending the original Host header, which requires
 * a custom undici Agent with a pinned `lookup`.
 */
export const PINNING_TODO =
  "DNS rebinding: pin the validated IP for the connection (custom undici lookup)";
