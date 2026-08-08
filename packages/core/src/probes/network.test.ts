import { describe, expect, it, vi } from "vitest";
import {
  assertHostAllowed,
  parseHostPort,
  probeDns,
  probeSsl,
  probeTcp,
  type CertificateFacts,
} from "./network.js";

const resolve = async (hostname: string): Promise<string[]> => {
  const map: Record<string, string[]> = {
    "example.com": ["93.184.216.34"],
    "internal.example.com": ["10.0.0.5"],
    "empty.com": [],
  };
  const found = map[hostname];
  if (!found) throw new Error(`ENOTFOUND ${hostname}`);
  return found;
};

function stepClock(stepMs = 10) {
  let t = 0;
  return () => {
    const current = t;
    t += stepMs;
    return current;
  };
}

describe("parseHostPort", () => {
  const valid: Array<[string, string, number]> = [
    ["example.com:5432", "example.com", 5432],
    ["10.0.0.1:80", "10.0.0.1", 80],
    ["[2001:db8::1]:443", "2001:db8::1", 443],
    ["example.com:1", "example.com", 1],
    ["example.com:65535", "example.com", 65535],
  ];

  it.each(valid)("parses %s", (input, host, port) => {
    expect(parseHostPort(input)).toEqual({ host, port });
  });

  const invalid = [
    "example.com",
    "",
    ":80",
    "example.com:0",
    "example.com:65536",
    "example.com:abc",
    // A bare IPv6 address must not be split on its last colon: doing so yields
    // the mangled host "fe80:" and the deny-list is then asked about a string
    // the user never supplied.
    "::1",
    "fe80::1",
    "0:0:0:0:0:ffff:7f00:1",
  ];

  it.each(invalid)("rejects %s", (input) => {
    expect(parseHostPort(input)).toBeNull();
  });
});

describe("assertHostAllowed", () => {
  it("allows a public hostname", async () => {
    expect(await assertHostAllowed("example.com", resolve)).toBeNull();
  });

  it("allows a public IP literal without resolving", async () => {
    const spy = vi.fn(async () => []);
    expect(await assertHostAllowed("8.8.8.8", spy)).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });

  it("blocks a private IP literal without resolving", async () => {
    const spy = vi.fn(async () => []);
    expect(await assertHostAllowed("127.0.0.1", spy)).toContain("loopback");
    expect(spy).not.toHaveBeenCalled();
  });

  const nonCanonical = ["0177.0.0.1", "2130706433", "127.1", "0x7f.0.0.1"];

  it.each(nonCanonical)("canonicalizes %s to loopback and blocks it", async (host) => {
    // These reach the TCP/SSL path as raw strings with no URL parsing to
    // normalize them, so without canonicalizeHost they are punted to DNS
    // unchecked - a bypass waiting for a lenient resolver.
    const spy = vi.fn(async () => []);
    expect(await assertHostAllowed(host, spy)).toContain("loopback");
    expect(spy).not.toHaveBeenCalled();
  });

  it("does not echo a link-local address back to the user", async () => {
    // Confirming the metadata endpoint was reached is itself information.
    const linkLocal = async () => ["169.254.169.254"];
    const reason = await assertHostAllowed("meta.example.com", linkLocal);
    expect(reason).toContain("link-local");
    expect(reason).not.toContain("169.254.169.254");
  });

  it("blocks a hostname that resolves privately", async () => {
    expect(await assertHostAllowed("internal.example.com", resolve)).toContain("10.0.0.5");
  });

  it("reports a resolution failure", async () => {
    expect(await assertHostAllowed("nowhere.com", resolve)).toContain("DNS resolution failed");
  });

  it("refuses a host with no addresses", async () => {
    expect(await assertHostAllowed("empty.com", resolve)).toContain("no addresses");
  });
});

describe("probeTcp", () => {
  const connect = async () => ({ connectMs: 12 });
  const deps = (over = {}) => ({ connect, resolve, now: stepClock(), ...over });

  it("succeeds when the port accepts a connection", async () => {
    const result = await probeTcp({ target: "example.com:443", timeoutMs: 5000 }, deps());
    expect(result.ok).toBe(true);
    expect(result.connectMs).toBe(12);
  });

  it("fails on a malformed target without attempting a connection", async () => {
    const spy = vi.fn(connect);
    const result = await probeTcp(
      { target: "example.com", timeoutMs: 5000 },
      deps({ connect: spy }),
    );
    expect(result.ok).toBe(false);
    expect(result.error).toContain("host:port");
    expect(spy).not.toHaveBeenCalled();
  });

  it("refuses a target resolving to a private address", async () => {
    // A TCP monitor pointed inside the network is just as effective a port
    // scanner as an HTTP one.
    const spy = vi.fn(connect);
    const result = await probeTcp(
      { target: "internal.example.com:6379", timeoutMs: 5000 },
      deps({ connect: spy }),
    );
    expect(result.ok).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });

  it("records a connection error as a failure", async () => {
    const failing = async () => {
      throw new Error("ECONNREFUSED");
    };
    const result = await probeTcp(
      { target: "example.com:9999", timeoutMs: 5000 },
      deps({ connect: failing }),
    );
    expect(result.ok).toBe(false);
    expect(result.error).toBe("ECONNREFUSED");
  });
});

describe("probeDns", () => {
  const deps = (records: string[] | Error) => ({
    lookup: async () => {
      if (records instanceof Error) throw records;
      return records;
    },
    resolve,
    now: stepClock(),
  });

  it("succeeds when records exist", async () => {
    const result = await probeDns(
      { hostname: "example.com", recordType: "A" },
      deps(["93.184.216.34"]),
    );
    expect(result.ok).toBe(true);
    expect(result.dnsMs).toBeGreaterThan(0);
  });

  it("fails when no records are returned", async () => {
    const result = await probeDns({ hostname: "example.com", recordType: "A" }, deps([]));
    expect(result.ok).toBe(false);
    expect(result.error).toContain("No A records");
  });

  it("succeeds when a record matches an expected value", async () => {
    const result = await probeDns(
      { hostname: "example.com", recordType: "A", expectedValues: ["93.184.216.34"] },
      deps(["93.184.216.34"]),
    );
    expect(result.ok).toBe(true);
  });

  it("matches expected values case-insensitively", async () => {
    // CNAME and MX targets are case-insensitive; comparing verbatim would
    // produce spurious failures when a provider changes casing.
    const result = await probeDns(
      { hostname: "example.com", recordType: "CNAME", expectedValues: ["Target.Example.COM"] },
      deps(["target.example.com"]),
    );
    expect(result.ok).toBe(true);
  });

  it("fails when no record matches the expectation", async () => {
    const result = await probeDns(
      { hostname: "example.com", recordType: "A", expectedValues: ["1.2.3.4"] },
      deps(["93.184.216.34"]),
    );
    expect(result.ok).toBe(false);
    expect(result.error).toContain("1.2.3.4");
  });

  it("ignores an empty expected list", async () => {
    const result = await probeDns(
      { hostname: "example.com", recordType: "A", expectedValues: [] },
      deps(["93.184.216.34"]),
    );
    expect(result.ok).toBe(true);
  });

  it("refuses a hostname that resolves privately", async () => {
    // Without this gate a DNS monitor is an internal-name resolution oracle:
    // point it at vault.prod.svc.cluster.local and read the A records out of
    // the incident cause.
    const lookup = vi.fn(async () => ["10.0.0.5"]);
    const result = await probeDns(
      { hostname: "internal.example.com", recordType: "A" },
      { lookup, resolve, now: stepClock() },
    );
    expect(result.ok).toBe(false);
    expect(lookup).not.toHaveBeenCalled();
  });

  it("refuses a blocked IP literal as the hostname", async () => {
    const lookup = vi.fn(async () => ["169.254.169.254"]);
    const result = await probeDns(
      { hostname: "169.254.169.254", recordType: "A" },
      { lookup, resolve, now: stepClock() },
    );
    expect(result.ok).toBe(false);
    expect(lookup).not.toHaveBeenCalled();
  });

  it("records a lookup failure", async () => {
    // Host must be resolvable so the SSRF gate passes and the lookup itself
    // is what fails.
    const result = await probeDns(
      { hostname: "example.com", recordType: "A" },
      deps(new Error("SERVFAIL")),
    );
    expect(result.ok).toBe(false);
    expect(result.error).toBe("SERVFAIL");
  });
});

describe("probeSsl", () => {
  const NOW = new Date("2026-06-01T00:00:00Z");
  const cert = (over: Partial<CertificateFacts> = {}): CertificateFacts => ({
    validFrom: new Date("2026-01-01T00:00:00Z"),
    validTo: new Date("2026-09-01T00:00:00Z"),
    issuer: "Test CA",
    handshakeMs: 40,
    ...over,
  });

  const deps = (facts: CertificateFacts | Error) => ({
    inspect: async () => {
      if (facts instanceof Error) throw facts;
      return facts;
    },
    resolve,
    now: stepClock(),
    clock: () => NOW,
  });

  const options = { target: "example.com", timeoutMs: 5000, warnWithinDays: 14 };

  it("succeeds on a certificate valid well into the future", async () => {
    const result = await probeSsl(options, deps(cert()));
    expect(result.ok).toBe(true);
    expect(result.tlsMs).toBe(40);
  });

  it("defaults to port 443", async () => {
    const inspect = vi.fn(async () => cert());
    await probeSsl(options, { ...deps(cert()), inspect });
    expect(inspect).toHaveBeenCalledWith("example.com", 443, 5000);
  });

  it("honours an explicit port", async () => {
    const inspect = vi.fn(async () => cert());
    await probeSsl({ ...options, target: "example.com:8443" }, { ...deps(cert()), inspect });
    expect(inspect).toHaveBeenCalledWith("example.com", 8443, 5000);
  });

  it("fails on an expired certificate", async () => {
    const result = await probeSsl(
      options,
      deps(cert({ validTo: new Date("2026-05-01T00:00:00Z") })),
    );
    expect(result.ok).toBe(false);
    expect(result.error).toContain("expired on 2026-05-01");
  });

  it("fails when expiry is inside the warning threshold", async () => {
    // The whole point of an SSL monitor: alert before the outage, not during it.
    const result = await probeSsl(
      options,
      deps(cert({ validTo: new Date("2026-06-08T00:00:00Z") })),
    );
    expect(result.ok).toBe(false);
    expect(result.error).toContain("expires in 7 day(s)");
  });

  it("passes just outside the warning threshold", async () => {
    const result = await probeSsl(
      options,
      deps(cert({ validTo: new Date("2026-06-16T00:00:00Z") })),
    );
    expect(result.ok).toBe(true);
  });

  it("fails on a not-yet-valid certificate", async () => {
    const result = await probeSsl(
      options,
      deps(cert({ validFrom: new Date("2026-07-01T00:00:00Z") })),
    );
    expect(result.ok).toBe(false);
    expect(result.error).toContain("not valid until 2026-07-01");
  });

  it("refuses a target resolving to a private address", async () => {
    const inspect = vi.fn(async () => cert());
    const result = await probeSsl(
      { ...options, target: "internal.example.com" },
      { ...deps(cert()), inspect },
    );
    expect(result.ok).toBe(false);
    expect(inspect).not.toHaveBeenCalled();
  });

  it("records a handshake failure", async () => {
    const result = await probeSsl(options, deps(new Error("CERT_HAS_EXPIRED")));
    expect(result.ok).toBe(false);
    expect(result.error).toBe("CERT_HAS_EXPIRED");
  });

  it("rejects an empty target", async () => {
    const result = await probeSsl({ ...options, target: "   " }, deps(cert()));
    expect(result.ok).toBe(false);
    expect(result.error).toBe("Invalid target");
  });
});
