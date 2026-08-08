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

DNS rebinding remains a residual risk: an attacker can return a public address at
validation time and a private one at connection time. Mitigating this fully
requires pinning the validated IP for the connection, which is tracked as
follow-up work.

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
