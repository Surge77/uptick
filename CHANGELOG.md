# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Security

- Close the DNS-rebinding gap in the SSRF guard. The guards now return the
  addresses they validated, those addresses travel with every request, and the
  HTTP, TCP, TLS and notification adapters connect through a pinned `lookup`
  instead of resolving the hostname a second time. An unpinned connection is
  refused rather than resolved

## [1.0.0] - 2026-08-09

### Added

- Monorepo scaffold: pnpm workspaces + Turborepo, TypeScript strict, ESLint,
  Prettier, Vitest, commitlint, husky
- GitHub Actions CI running the full quality gate on Node 24
- Documentation set: architecture, data model, runbook, and ADRs 0001–0003
- Contribution, security, and code-of-conduct policies
- Prisma schema with partitioned checks, daily rollups, and seed data
- Verdict state machine with per-region folding, quorum clamped to active
  regions, flap suppression, and ledger SLA math from incident durations
- Probe executors (HTTP, TCP, ICMP, SSL, DNS, heartbeat) behind an SSRF
  guard that validates every resolved IP
- Worker scheduler leasing monitors with `FOR UPDATE SKIP LOCKED`
- Incident lifecycle, daily rollups, raw-check retention, heartbeats
- Alert dispatch (herald) with at-most-once delivery, dedup and escalation
- Web dashboard: Auth.js v5 GitHub sign-in with database sessions,
  organization-scoped tenancy, monitor CRUD with SSRF pre-filtering,
  incident acknowledgement, audit logging, error-budget meters
- Automatic personal-organization provisioning on first sign-in
- Public status pages at `/status/[slug]` exposing only published
  components; `IncidentUpdate` timelines, never internal incident causes
- Status page management: create, edit, and choose published monitors with
  cross-tenant intersection on write
- Dependency-graph alert suppression: a dependent service does not page
  when the monitor it depends on is already down
- Error budgets and burn rate computed from SLO targets
- Deploy correlation: signed webhook (`POST /api/deploys`) records deploy
  markers; HMAC with timestamp inside the signed payload, timing-safe
  comparison, uniform rejections
- Sliding-window rate limiting on the deploy webhook: in-memory
  per-instance by default, Upstash Redis over REST when configured
- Instrument-panel interface: Archivo + IBM Plex Mono via `next/font`,
  phosphor-on-graphite palette, SVG latency charts and sparklines with a
  shared p50/p95 domain, uptime strips padded to a fixed window
- Worker Dockerfile for Railway deployment; demo seed and local inspection
  scripts

[Unreleased]: https://github.com/Surge77/uptick/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/Surge77/uptick/commits/v1.0.0
