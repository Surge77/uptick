import { describe, expect, it } from "vitest";
import { canonicalizeHost, checkResolvedIp, checkUrl, parseIp, unwrapMappedIpv4 } from "./ssrf.js";

describe("parseIp", () => {
  it("parses a dotted-quad IPv4 address", () => {
    expect(parseIp("192.0.2.1")).toEqual({ version: 4, bytes: [192, 0, 2, 1] });
  });

  it("parses the IPv6 loopback", () => {
    const parsed = parseIp("::1");
    expect(parsed?.version).toBe(6);
    expect(parsed?.bytes[15]).toBe(1);
  });

  it("parses a full IPv6 address", () => {
    expect(parseIp("2001:0db8:0000:0000:0000:0000:0000:0001")?.version).toBe(6);
  });

  it("parses a compressed IPv6 address", () => {
    expect(parseIp("2001:db8::1")?.bytes).toEqual(parseIp("2001:db8:0:0:0:0:0:1")?.bytes);
  });

  it("strips a bracketed IPv6 literal", () => {
    expect(parseIp("[::1]")?.version).toBe(6);
  });

  it("strips an IPv6 zone index", () => {
    expect(parseIp("fe80::1%eth0")?.version).toBe(6);
  });

  const rejected = [
    ["a hostname", "example.com"],
    ["an empty string", ""],
    ["too few IPv4 octets", "127.0.0"],
    ["too many IPv4 octets", "1.2.3.4.5"],
    ["an out-of-range octet", "999.0.0.1"],
    ["a zero-padded octet", "127.000.000.001"],
    ["an octal-looking octet", "0177.0.0.1"],
    ["a decimal integer address", "2130706433"],
    ["a hex address", "0x7f000001"],
    ["a double compression", "1::2::3"],
    ["a bad IPv6 group", "2001:zzzz::1"],
    ["an over-long IPv6 group", "2001:db8::12345"],
    ["a truncated IPv6 address", "2001:db8:1:2"],
  ] as const;

  it.each(rejected)("rejects %s", (_name, input) => {
    expect(parseIp(input)).toBeNull();
  });
});

describe("unwrapMappedIpv4", () => {
  it("unwraps an IPv4-mapped address to IPv4", () => {
    const unwrapped = unwrapMappedIpv4(parseIp("::ffff:127.0.0.1")!);
    expect(unwrapped).toEqual({ version: 4, bytes: [127, 0, 0, 1] });
  });

  it("leaves an ordinary IPv6 address alone", () => {
    expect(unwrapMappedIpv4(parseIp("2001:db8::1")!).version).toBe(6);
  });

  it("leaves an IPv4 address alone", () => {
    expect(unwrapMappedIpv4(parseIp("8.8.8.8")!).version).toBe(4);
  });

  it("does not misread ::1 as an IPv4 address", () => {
    expect(unwrapMappedIpv4(parseIp("::1")!).version).toBe(6);
  });

  it("does not misread :: as an IPv4 address", () => {
    expect(unwrapMappedIpv4(parseIp("::")!).version).toBe(6);
  });
});

describe("checkResolvedIp", () => {
  describe("blocks IPv4 ranges", () => {
    const blocked = [
      ["the AWS/GCP/Azure metadata endpoint", "169.254.169.254"],
      ["link-local generally", "169.254.1.1"],
      ["loopback", "127.0.0.1"],
      ["the whole loopback /8", "127.255.255.254"],
      ["private 10/8", "10.0.0.1"],
      ["private 172.16/12 at its low edge", "172.16.0.1"],
      ["private 172.16/12 at its high edge", "172.31.255.254"],
      ["private 192.168/16", "192.168.1.1"],
      ["the unspecified address", "0.0.0.0"],
      ["carrier-grade NAT", "100.64.0.1"],
      ["IETF protocol assignments", "192.0.0.1"],
      ["documentation TEST-NET-1", "192.0.2.1"],
      ["benchmarking", "198.18.0.1"],
      ["documentation TEST-NET-2", "198.51.100.1"],
      ["documentation TEST-NET-3", "203.0.113.1"],
      ["multicast", "224.0.0.1"],
      ["reserved", "240.0.0.1"],
      ["the broadcast address", "255.255.255.255"],
    ] as const;

    it.each(blocked)("blocks %s", (_name, ip) => {
      const verdict = checkResolvedIp(ip);
      expect(verdict.allowed).toBe(false);
    });

    it("names the metadata endpoint's range in the reason", () => {
      const verdict = checkResolvedIp("169.254.169.254");
      expect(verdict.allowed).toBe(false);
      if (!verdict.allowed) {
        expect(verdict.cidr).toBe("169.254.0.0/16");
        expect(verdict.reason).toContain("metadata");
      }
    });
  });

  describe("blocks IPv6 ranges", () => {
    const blocked = [
      ["loopback", "::1"],
      ["the unspecified address", "::"],
      ["unique local", "fc00::1"],
      ["unique local at fd00", "fd12:3456::1"],
      ["link-local", "fe80::1"],
      ["multicast", "ff02::1"],
      ["NAT64", "64:ff9b::1"],
      ["discard-only", "100::1"],
      ["documentation", "2001:db8::1"],
    ] as const;

    it.each(blocked)("blocks %s", (_name, ip) => {
      expect(checkResolvedIp(ip).allowed).toBe(false);
    });
  });

  describe("blocks IPv4-mapped IPv6 bypasses", () => {
    // The classic bypass: these match no IPv6 deny range, so a guard that skips
    // unwrapping lets them straight through to loopback and cloud metadata.
    const bypasses = [
      ["mapped loopback", "::ffff:127.0.0.1"],
      ["mapped metadata endpoint", "::ffff:169.254.169.254"],
      ["mapped private address", "::ffff:10.0.0.1"],
      ["mapped private 192.168", "::ffff:192.168.1.1"],
    ] as const;

    it.each(bypasses)("blocks %s", (_name, ip) => {
      expect(checkResolvedIp(ip).allowed).toBe(false);
    });

    it("still allows a mapped public address", () => {
      expect(checkResolvedIp("::ffff:8.8.8.8").allowed).toBe(true);
    });
  });

  describe("allows public addresses", () => {
    const allowed = [
      "8.8.8.8",
      "1.1.1.1",
      "93.184.216.34",
      "172.32.0.1",
      "9.255.255.255",
      "2606:4700::1111",
    ];

    it.each(allowed)("allows %s", (ip) => {
      expect(checkResolvedIp(ip).allowed).toBe(true);
    });

    it("allows the address just outside private 172.16/12", () => {
      // 172.32.0.1 is public; 172.31.255.255 is not. Off-by-one in the mask
      // would either block legitimate traffic or expose the private range.
      expect(checkResolvedIp("172.32.0.0").allowed).toBe(true);
      expect(checkResolvedIp("172.31.255.255").allowed).toBe(false);
    });

    it("allows the address just outside loopback", () => {
      expect(checkResolvedIp("128.0.0.1").allowed).toBe(true);
      expect(checkResolvedIp("126.255.255.255").allowed).toBe(true);
    });
  });

  it("denies anything it cannot parse rather than assuming it is public", () => {
    // Fail closed: an unparseable address means the deny-list was never
    // actually applied.
    const verdict = checkResolvedIp("not-an-ip");
    expect(verdict.allowed).toBe(false);
  });
});

describe("checkUrl", () => {
  it("allows an ordinary https URL", () => {
    const verdict = checkUrl("https://example.com/health");
    expect(verdict.allowed).toBe(true);
    if (verdict.allowed) expect(verdict.hostname).toBe("example.com");
  });

  it("allows http", () => {
    expect(checkUrl("http://example.com").allowed).toBe(true);
  });

  it("reports an explicit port", () => {
    const verdict = checkUrl("https://example.com:8443/x");
    expect(verdict.allowed).toBe(true);
    if (verdict.allowed) expect(verdict.port).toBe(8443);
  });

  it("reports a null port when none is given", () => {
    const verdict = checkUrl("https://example.com");
    if (verdict.allowed) expect(verdict.port).toBeNull();
  });

  const rejectedProtocols = [
    ["file", "file:///etc/passwd"],
    ["gopher", "gopher://example.com/"],
    ["ftp", "ftp://example.com/"],
    ["data", "data:text/plain,hello"],
  ] as const;

  it.each(rejectedProtocols)("rejects the %s protocol", (_name, url) => {
    expect(checkUrl(url).allowed).toBe(false);
  });

  it("rejects a malformed URL", () => {
    expect(checkUrl("not a url").allowed).toBe(false);
  });

  it("rejects embedded credentials", () => {
    // These would otherwise be written verbatim into logs and incident causes.
    const verdict = checkUrl("https://user:secret@example.com/");
    expect(verdict.allowed).toBe(false);
    if (!verdict.allowed) expect(verdict.reason).toContain("Credentials");
  });

  it("rejects a literal loopback host", () => {
    expect(checkUrl("http://127.0.0.1:8080/admin").allowed).toBe(false);
  });

  it("rejects the literal metadata endpoint", () => {
    const verdict = checkUrl("http://169.254.169.254/latest/meta-data/");
    expect(verdict.allowed).toBe(false);
    if (!verdict.allowed) expect(verdict.reason).toContain("metadata");
  });

  it("rejects a bracketed IPv6 loopback literal", () => {
    expect(checkUrl("http://[::1]:3000/").allowed).toBe(false);
  });

  it("rejects an IPv4-mapped IPv6 literal", () => {
    expect(checkUrl("http://[::ffff:127.0.0.1]/").allowed).toBe(false);
  });

  it("allows a public IP literal", () => {
    expect(checkUrl("https://8.8.8.8/").allowed).toBe(true);
  });

  it("does not resolve hostnames itself", () => {
    // A name that will resolve to loopback still passes the structural check.
    // This is exactly why checkResolvedIp must run after resolution — the
    // structural check is a pre-filter, not the security boundary.
    expect(checkUrl("http://localhost.example.com/").allowed).toBe(true);
  });
});

describe("tunnelled and translated address ranges", () => {
  // 6to4 and Teredo embed an arbitrary IPv4 address inside an IPv6 one. A
  // deny-list that only covers the obvious v6 ranges lets 2002:a9fe:a9fe::
  // reach the metadata endpoint on any host with a 6to4 tunnel.
  const blocked = [
    ["6to4-encapsulated metadata endpoint", "2002:a9fe:a9fe::"],
    ["6to4-encapsulated loopback", "2002:7f00:1::"],
    ["6to4 relay anycast", "192.88.99.1"],
    ["Teredo", "2001:0:7f00:1::"],
    ["deprecated site-local", "fec0::1"],
    ["IPv4-translated (SIIT)", "::ffff:0:7f00:1"],
    ["ORCHIDv2", "2001:20::1"],
  ] as const;

  it.each(blocked)("blocks %s", (_name, ip) => {
    expect(checkResolvedIp(ip).allowed).toBe(false);
  });
});

describe("verdict discriminant", () => {
  it("marks a non-IP string as unparseable so callers may resolve it", () => {
    const verdict = checkResolvedIp("example.com");
    expect(verdict.allowed).toBe(false);
    if (!verdict.allowed) expect(verdict.kind).toBe("unparseable");
  });

  it("marks a forbidden address as denied", () => {
    const verdict = checkResolvedIp("127.0.0.1");
    if (!verdict.allowed) expect(verdict.kind).toBe("denied");
  });
});

describe("parser strictness", () => {
  it("rejects a zero-width :: elision, matching net.isIP", () => {
    // Accepting these makes the parser disagree with Node's resolver, and
    // parser/resolver disagreement is the shape every SSRF bypass takes.
    expect(parseIp("1:2:3:4:5:6:7:8::")).toBeNull();
    expect(parseIp("::1:2:3:4:5:6:7:8")).toBeNull();
  });
});

describe("canonicalizeHost", () => {
  const cases: Array<[string, string]> = [
    ["0177.0.0.1", "127.0.0.1"],
    ["2130706433", "127.0.0.1"],
    ["127.1", "127.0.0.1"],
    ["0x7f.0.0.1", "127.0.0.1"],
    ["example.com", "example.com"],
    ["8.8.8.8", "8.8.8.8"],
  ];

  it.each(cases)("canonicalizes %s to %s", (input, expected) => {
    expect(canonicalizeHost(input)).toBe(expected);
  });

  it("leaves an IPv6 literal intact", () => {
    expect(canonicalizeHost("::1")).toBe("::1");
  });

  it("returns an empty string unchanged", () => {
    expect(canonicalizeHost("  ")).toBe("");
  });
});
