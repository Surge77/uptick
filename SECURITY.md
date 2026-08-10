# Security Policy

## Reporting a vulnerability

**Please do not open a public issue for security vulnerabilities.**

Report privately via
[GitHub Security Advisories](https://github.com/Surge77/uptick/security/advisories/new).

Please include:

- A description of the vulnerability and its impact
- Steps to reproduce, or a proof of concept
- Affected version or commit
- Any suggested remediation

**Response targets:** acknowledgement within 72 hours, an initial assessment
within 7 days, and a fix or mitigation plan within 30 days for confirmed
high-severity issues. You will be credited in the advisory unless you prefer
otherwise.

## Supported versions

| Version         | Supported |
| --------------- | --------- |
| `main` (latest) | ✅        |
| Older tags      | ❌        |

## Threat model

Uptick accepts user-supplied URLs and hostnames and then makes outbound network
requests to them. That makes **server-side request forgery the highest-severity
risk class in this codebase**, ahead of anything in the UI.

### SSRF — probe and webhook targets

Both monitor targets and webhook notification URLs are attacker-influenced. The
controls, all of which must hold:

- **Resolve DNS first, then validate the resolved IP.** Validating the hostname
  string is not sufficient — an attacker controls their own DNS and can point any
  hostname at `169.254.169.254`.
- **Re-validate on every redirect hop.** A public first hop can redirect to an
  internal address. Validating only the initial URL is a common and complete
  bypass.
- **Deny-list** loopback (`127.0.0.0/8`, `::1`), link-local (`169.254.0.0/16`,
  `fe80::/10`), private (`10/8`, `172.16/12`, `192.168/16`), unique-local
  (`fc00::/7`), and unspecified addresses.
- **Cap redirects and response body size** to prevent redirect loops and memory
  exhaustion.

Additional controls added after the Phase 3 security review:

- **Decode IPv4-mapped IPv6 before matching.** `::ffff:127.0.0.1` matches no
  IPv6 deny range; without unwrapping it reaches loopback.
- **Canonicalize bare hosts.** TCP and TLS targets are raw strings with no URL
  parsing, so `0177.0.0.1` and `2130706433` are normalized before the check
  rather than punted to DNS.
- **Block tunnelled ranges.** 6to4 (`2002::/16`) and Teredo (`2001::/32`)
  encapsulate arbitrary IPv4 addresses, so `2002:a9fe:a9fe::` would otherwise
  reach the metadata endpoint.
- **Gate DNS monitors.** Without a check, a DNS monitor is an internal-name
  resolution oracle for names like `vault.prod.svc.cluster.local`.
- **Strip credential headers on cross-origin redirects** and refuse
  `https:` → `http:` downgrades, so an open redirect cannot replay a bearer
  token to another origin in plaintext.
- **Screen user-supplied regular expressions.** `bodyMatches` runs on the
  shared worker event loop, which Node cannot interrupt; a catastrophic pattern
  would stall every tenant's checks while appearing healthy.

- **Pin the validated address for the connection.** Every guard returns the
  addresses it approved, and they travel with the request (`pinnedAddresses`).
  The adapters connect through `pinnedLookup`, a `lookup` implementation that
  returns only those addresses and never queries DNS. Without this, the socket
  resolves the name a _second_ time and the target's own nameserver answers —
  publicly for the check, `127.0.0.1` for the connect. That is DNS rebinding,
  and it defeats an otherwise complete deny-list. The pin overrides `lookup`
  rather than rewriting the host, so the `Host` header, TLS SNI and certificate
  verification all remain correct. An empty pin is refused rather than resolved:
  empty means nothing was ever validated.

**Adapter contracts.** The `Resolver`, `HttpTransport`, `TcpConnector` and
`CertificateInspector` ports carry binding requirements, documented alongside
each type: the resolver must return every A _and_ AAAA address using
`dns.lookup` semantics, the transport must not follow redirects itself, and
every connector must dial a pinned address rather than re-resolving. An adapter
that follows redirects internally bypasses the per-hop re-check entirely while
every unit test still passes — the tests inject fakes and prove nothing about
the real socket. That is why `transport.integration.test.ts` asserts both
properties against a real server, including a request to a hostname that
resolves nowhere: it can only succeed via the pin.

### Other boundaries

| Boundary              | Threat                                | Control                                                     |
| --------------------- | ------------------------------------- | ----------------------------------------------------------- |
| API routes            | Cross-tenant access                   | Org scope derived from the session, never from client input |
| Public status page    | Enumeration, scraping                 | Rate limited; only explicitly published monitors exposed    |
| Notification channels | Alert spam as an amplification vector | Channel verification before first send                      |
| Probe responses       | Memory exhaustion                     | Capped body read                                            |
| Auth                  | Session fixation, CSRF                | Auth.js v5 defaults, unmodified                             |

## Handling secrets

- Secrets live in `.env.local` (git-ignored) locally, and in the Vercel/Railway
  environment in production.
- `.env.example` documents every variable and contains **no values**.
- Never log secrets, tokens, or URLs containing embedded credentials.
- Rotate immediately if a secret is ever committed — removing it from history is
  not sufficient, as it must be assumed captured.

## Dependencies

`pnpm audit` runs in CI. Dependencies are pinned to exact versions. New
dependencies require justification in the PR description covering maintenance
status, known CVEs, license, and bundle impact.
