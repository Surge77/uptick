import {
  probeDns,
  probeHttp,
  probeSsl,
  probeTcp,
  type CertificateInspector,
  type DnsLookup,
  type DnsRecordType,
  type HttpTransport,
  type ProbeResult,
  type Resolver,
  type TcpConnector,
} from "@uptick/core";
import type { LeasedMonitor } from "./scheduler.js";

export interface DispatchDeps {
  transport: HttpTransport;
  resolve: Resolver;
  connect: TcpConnector;
  inspect: CertificateInspector;
  lookup: DnsLookup;
  now: () => number;
  clock: () => Date;
}

const DEFAULT_SSL_WARN_DAYS = 14;
const DNS_RECORD_TYPES: readonly DnsRecordType[] = ["A", "AAAA", "CNAME", "MX", "TXT", "NS"];

function unsupported(type: string): ProbeResult {
  return {
    ok: false,
    statusCode: null,
    latencyMs: 0,
    error: `Probe type ${type} is not supported by this worker`,
    dnsMs: null,
    connectMs: null,
    tlsMs: null,
    ttfbMs: null,
  };
}

/**
 * Parse a DNS monitor's target, which encodes the record type after a slash:
 * `example.com/A`, `example.com/MX`. Defaults to `A`.
 */
export function parseDnsTarget(target: string): { hostname: string; recordType: DnsRecordType } {
  const [hostname, suffix] = target.split("/");
  const upper = suffix?.trim().toUpperCase();
  const recordType = DNS_RECORD_TYPES.find((t) => t === upper) ?? "A";
  return { hostname: (hostname ?? "").trim(), recordType };
}

/**
 * Route a leased monitor to the probe for its type.
 *
 * ICMP is deliberately unimplemented rather than faked. A real ping needs a raw
 * socket, which needs elevated privileges the worker container does not have
 * and should not be granted; shelling out to `ping` would make the result
 * depend on the base image's binary. Reporting it as unsupported is honest —
 * silently substituting a TCP connect would report "up" for a host that does
 * not answer ICMP at all.
 */
export async function dispatchProbe(
  monitor: LeasedMonitor,
  deps: DispatchDeps,
): Promise<ProbeResult> {
  switch (monitor.type) {
    case "HTTP":
      return probeHttp(
        { url: monitor.target, timeoutMs: monitor.timeoutMs },
        { transport: deps.transport, resolve: deps.resolve, now: deps.now },
      );

    case "TCP":
      return probeTcp(
        { target: monitor.target, timeoutMs: monitor.timeoutMs },
        { connect: deps.connect, resolve: deps.resolve, now: deps.now },
      );

    case "SSL":
      return probeSsl(
        {
          target: monitor.target,
          timeoutMs: monitor.timeoutMs,
          warnWithinDays: DEFAULT_SSL_WARN_DAYS,
        },
        { inspect: deps.inspect, resolve: deps.resolve, now: deps.now, clock: deps.clock },
      );

    case "DNS": {
      const { hostname, recordType } = parseDnsTarget(monitor.target);
      return probeDns(
        { hostname, recordType },
        { lookup: deps.lookup, resolve: deps.resolve, now: deps.now },
      );
    }

    case "HEARTBEAT":
      // Heartbeats are push-based: the job calls us. There is nothing for the
      // scheduler to probe, and staleness is evaluated separately.
      return unsupported("HEARTBEAT (push-based, evaluated by the heartbeat sweeper)");

    case "ICMP":
      return unsupported("ICMP (requires raw socket privileges)");
  }
}
