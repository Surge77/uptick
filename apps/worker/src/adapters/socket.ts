import { connect as netConnect } from "node:net";
import { connect as tlsConnect } from "node:tls";
import {
  resolve4,
  resolve6,
  resolveCname,
  resolveMx,
  resolveNs,
  resolveTxt,
} from "node:dns/promises";
import type { CertificateFacts, CertificateInspector, DnsLookup, TcpConnector } from "@uptick/core";
import { pinnedLookup } from "./pinned-lookup.js";

/**
 * TCP connector.
 *
 * Timeouts are enforced with the socket's own timer and the socket is always
 * destroyed on the way out. A leaked socket per failed probe would exhaust the
 * file-descriptor limit within hours at production check rates.
 *
 * `lookup` is pinned to the addresses the SSRF guard validated, so this socket
 * cannot land somewhere the deny-list never saw.
 */
export const nodeTcpConnect: TcpConnector = (host, port, timeoutMs, pinnedAddresses) =>
  new Promise((resolve, reject) => {
    const startedAt = performance.now();
    const socket = netConnect({ host, port, lookup: pinnedLookup(pinnedAddresses) });

    const done = (error?: Error): void => {
      socket.removeAllListeners();
      socket.destroy();
      if (error) reject(error);
      else resolve({ connectMs: Math.round(performance.now() - startedAt) });
    };

    socket.setTimeout(timeoutMs, () =>
      done(new Error(`Connection timed out after ${timeoutMs}ms`)),
    );
    socket.once("connect", () => done());
    socket.once("error", (error) => done(error));
  });

/**
 * Read a peer certificate.
 *
 * `rejectUnauthorized: false` is deliberate and safe here: the probe's job is
 * to REPORT on the certificate, including expired and self-signed ones. A
 * monitor that refuses to connect to an expired certificate cannot tell you it
 * expired — it just reports a connection error, which is the wrong diagnosis.
 * No user data is ever sent over this connection.
 *
 * `servername` stays the hostname while `lookup` pins the address: the pin must
 * not change which name is sent in SNI, or a name-based virtual host answers
 * with the wrong certificate and the probe reports a mismatch that is its own
 * doing.
 */
export const nodeInspectCertificate: CertificateInspector = (
  host,
  port,
  timeoutMs,
  pinnedAddresses,
): Promise<CertificateFacts> =>
  new Promise((resolve, reject) => {
    const startedAt = performance.now();
    const socket = tlsConnect({
      host,
      port,
      servername: host,
      rejectUnauthorized: false,
      lookup: pinnedLookup(pinnedAddresses),
    });

    const fail = (error: Error): void => {
      socket.removeAllListeners();
      socket.destroy();
      reject(error);
    };

    socket.setTimeout(timeoutMs, () =>
      fail(new Error(`TLS handshake timed out after ${timeoutMs}ms`)),
    );
    socket.once("error", fail);

    socket.once("secureConnect", () => {
      const cert = socket.getPeerCertificate();
      const handshakeMs = Math.round(performance.now() - startedAt);
      socket.removeAllListeners();
      socket.destroy();

      if (!cert || Object.keys(cert).length === 0) {
        reject(new Error("No peer certificate presented"));
        return;
      }

      resolve({
        validFrom: new Date(cert.valid_from),
        validTo: new Date(cert.valid_to),
        issuer: cert.issuer?.CN ?? null,
        handshakeMs,
      });
    });
  });

/**
 * DNS record lookup for DNS monitors.
 *
 * Uses `dns.resolve*` rather than `dns.lookup` because the point here is to
 * report what the authoritative records ARE, not which address the OS would
 * connect to. That is the opposite of the resolver used for SSRF checks, and
 * the distinction is intentional: this function must never be used as a
 * security check.
 */
export const nodeDnsLookup: DnsLookup = async (hostname, type) => {
  switch (type) {
    case "A":
      return resolve4(hostname);
    case "AAAA":
      return resolve6(hostname);
    case "CNAME":
      return resolveCname(hostname);
    case "NS":
      return resolveNs(hostname);
    case "TXT":
      return (await resolveTxt(hostname)).map((parts) => parts.join(""));
    case "MX":
      return (await resolveMx(hostname)).map((mx) => `${mx.priority} ${mx.exchange}`);
  }
};
