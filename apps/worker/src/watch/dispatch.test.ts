import { describe, expect, it, vi } from "vitest";
import type { HttpExchange } from "@uptick/core";
import { dispatchProbe, parseDnsTarget, type DispatchDeps } from "./dispatch.js";
import type { LeasedMonitor } from "./scheduler.js";

function stepClock(step = 10) {
  let t = 0;
  return () => {
    const c = t;
    t += step;
    return c;
  };
}

const exchange: HttpExchange = { status: 200, headers: {}, body: "ok" };

function deps(over: Partial<DispatchDeps> = {}): DispatchDeps {
  return {
    transport: async () => exchange,
    resolve: async () => ["93.184.216.34"],
    connect: async () => ({ connectMs: 5 }),
    inspect: async () => ({
      validFrom: new Date("2026-01-01T00:00:00Z"),
      validTo: new Date("2027-01-01T00:00:00Z"),
      issuer: "CA",
      handshakeMs: 20,
    }),
    lookup: async () => ["93.184.216.34"],
    now: stepClock(),
    clock: () => new Date("2026-06-01T00:00:00Z"),
    ...over,
  };
}

function monitor(over: Partial<LeasedMonitor>): LeasedMonitor {
  return {
    id: "m1",
    name: "test",
    type: "HTTP",
    target: "https://example.com",
    intervalSec: 60,
    timeoutMs: 5000,
    ...over,
  };
}

describe("parseDnsTarget", () => {
  const cases: Array<[string, string, string]> = [
    ["example.com/A", "example.com", "A"],
    ["example.com/mx", "example.com", "MX"],
    ["example.com/TXT", "example.com", "TXT"],
    ["example.com", "example.com", "A"],
    ["example.com/bogus", "example.com", "A"],
    [" example.com / cname ", "example.com", "CNAME"],
  ];

  it.each(cases)("parses %s", (input, hostname, recordType) => {
    expect(parseDnsTarget(input)).toEqual({ hostname, recordType });
  });
});

describe("dispatchProbe", () => {
  it("routes HTTP monitors to the HTTP probe", async () => {
    const transport = vi.fn(async () => exchange);
    const result = await dispatchProbe(monitor({ type: "HTTP" }), deps({ transport }));

    expect(result.ok).toBe(true);
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it("routes TCP monitors to the TCP probe", async () => {
    const connect = vi.fn(async () => ({ connectMs: 5 }));
    const result = await dispatchProbe(
      monitor({ type: "TCP", target: "example.com:5432" }),
      deps({ connect }),
    );

    expect(result.ok).toBe(true);
    expect(connect).toHaveBeenCalledWith("example.com", 5432, 5000, ["93.184.216.34"]);
  });

  it("routes SSL monitors to the certificate probe", async () => {
    const result = await dispatchProbe(monitor({ type: "SSL", target: "example.com" }), deps());
    expect(result.ok).toBe(true);
    expect(result.tlsMs).toBe(20);
  });

  it("routes DNS monitors and honours the record type suffix", async () => {
    const lookup = vi.fn(async () => ["mail.example.com"]);
    const result = await dispatchProbe(
      monitor({ type: "DNS", target: "example.com/MX" }),
      deps({ lookup }),
    );

    expect(result.ok).toBe(true);
    expect(lookup).toHaveBeenCalledWith("example.com", "MX");
  });

  it("reports ICMP as unsupported rather than substituting a TCP connect", async () => {
    // Silently probing TCP instead would report "up" for a host that does not
    // answer ICMP at all - a wrong answer is worse than a missing one.
    const connect = vi.fn(async () => ({ connectMs: 5 }));
    const result = await dispatchProbe(monitor({ type: "ICMP" }), deps({ connect }));

    expect(result.ok).toBe(false);
    expect(result.error).toContain("raw socket");
    expect(connect).not.toHaveBeenCalled();
  });

  it("reports HEARTBEAT as not scheduler-driven", async () => {
    const result = await dispatchProbe(monitor({ type: "HEARTBEAT" }), deps());
    expect(result.ok).toBe(false);
    expect(result.error).toContain("push-based");
  });

  it("still enforces SSRF protection through the dispatcher", async () => {
    // The dispatcher must not become a way around the guard.
    const transport = vi.fn(async () => exchange);
    const result = await dispatchProbe(
      monitor({ type: "HTTP", target: "http://169.254.169.254/" }),
      deps({ transport }),
    );

    expect(result.ok).toBe(false);
    expect(transport).not.toHaveBeenCalled();
  });

  it("blocks a TCP monitor pointed at a privately-resolving host", async () => {
    const connect = vi.fn(async () => ({ connectMs: 5 }));
    const result = await dispatchProbe(
      monitor({ type: "TCP", target: "internal.example.com:6379" }),
      deps({ connect, resolve: async () => ["10.0.0.5"] }),
    );

    expect(result.ok).toBe(false);
    expect(connect).not.toHaveBeenCalled();
  });
});
