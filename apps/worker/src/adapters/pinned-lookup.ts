import { isIP, type LookupFunction } from "node:net";

/**
 * Build a `lookup` that returns pre-validated addresses instead of querying DNS.
 *
 * This is the connect-time half of the SSRF guard. The guard resolves a target
 * and checks every address; without this, the socket then resolves the name a
 * SECOND time, and that second answer comes from the nameserver of the host
 * being monitored. Answering publicly for the check and 127.0.0.1 for the
 * connect is DNS rebinding, and it defeats an otherwise perfect deny-list.
 *
 * Overriding `lookup` rather than rewriting the target address is deliberate:
 * `net`/`tls` still believe they are connecting to the hostname, so the Host
 * header, the TLS SNI name and certificate verification all stay correct. A
 * probe that connected to a raw IP would report certificate errors for every
 * name-based virtual host.
 *
 * This function does NOT re-run the deny-list. Policy lives in one place —
 * `@uptick/core`'s guard — and a second check here would both duplicate it and
 * make the adapter untestable against a local server, which is the only kind of
 * test that can prove an adapter's socket behaviour at all.
 */
export function pinnedLookup(pinnedAddresses: readonly string[]): LookupFunction {
  if (pinnedAddresses.length === 0) {
    throw new Error("Refusing to connect: no validated address was pinned for this target");
  }

  const entries = pinnedAddresses.map((address) => {
    const family = isIP(address);
    if (family === 0) {
      throw new Error(`Refusing to connect: pinned target ${address} is not an IP address`);
    }
    return { address, family };
  });

  const first = entries[0]!;

  return (_hostname, options, callback) => {
    // Happy Eyeballs (`autoSelectFamily`) asks for the whole list; the older
    // path asks for one. Both shapes must be honoured or the socket hangs.
    if (options.all === true) callback(null, entries);
    else callback(null, first.address, first.family);
  };
}
