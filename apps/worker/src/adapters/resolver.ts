import { lookup } from "node:dns/promises";
import type { Resolver } from "@uptick/core";

/**
 * Node adapter for the `Resolver` port.
 *
 * The port's contract is load-bearing for SSRF protection, so the choices here
 * are not incidental:
 *
 *  - `dns.lookup`, not `dns.resolve4`. `lookup` goes through the OS resolver,
 *    consulting `/etc/hosts`, nsswitch and search domains exactly as the
 *    connect path does. `resolve4` queries DNS directly and can therefore
 *    return a different answer than the socket will actually use — and a
 *    checker that disagrees with the connector is not a checker.
 *  - `all: true`, so EVERY address is returned. With only the first, a
 *    dual-stack host whose AAAA is `::1` passes the check and then connects to
 *    loopback.
 *  - `verbatim: true`, so the OS ordering is preserved rather than reordered by
 *    Node. We validate all of them regardless, but the list must be the same
 *    list the connector sees.
 */
export const nodeResolver: Resolver = async (hostname: string): Promise<string[]> => {
  const records = await lookup(hostname, { all: true, verbatim: true });
  return records.map((record) => record.address);
};
