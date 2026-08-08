# Architecture

## Overview

Uptick is split into two deployable units and two shared libraries.

| Unit                       | Runtime                 | Hosting                          | Responsibility                     |
| -------------------------- | ----------------------- | -------------------------------- | ---------------------------------- |
| `apps/worker` (an **eye**) | Long-lived Node process | Railway, one instance per region | Probe targets, write results       |
| `apps/web`                 | Next.js 16              | Vercel                           | Dashboard, API, public status page |
| `packages/core`            | Library                 | —                                | All decision logic, pure           |
| `packages/db`              | Library                 | —                                | Prisma schema + client             |

## Why a worker and not a cron function

Serverless cron cannot do this job:

- **Vercel Cron's minimum interval is 1 minute**, and firing is best-effort. A
  monitoring product that silently skips checks is worse than no product.
- Function execution caps bound how many targets one tick can fan out to.
- There is no stable regional identity, so multi-region quorum is impossible.

A long-lived process ticks every 10 seconds, holds a concurrency pool, and knows
which region it is. See [ADR 0002](./adr/0002-worker-not-cron.md).

## Data flow

```
        ┌────────── every 10s ──────────┐
        ▼                               │
  watch: lease due monitors             │
  (FOR UPDATE SKIP LOCKED)              │
        │                               │
        ▼                               │
  probe executor (p-limit pool)         │
        │                               │
        ▼                               │
  Check row  ─────────────────────────► │
        │
        ▼
  verdict: fold last N results per region
        │
        ▼
  quorum: ≥2 of 3 regions agree?
        │
        ├── no  → record, no state change
        └── yes → state transition
                    │
                    ▼
              Incident open/resolve
                    │
                    ▼
              suppression checks
              (maintenance? flapping? ancestor down?)
                    │
                    ▼
              herald → dedupe → dispatch

  nightly: ledger → CheckRollup, prune Check > 30d
```

## The three load-bearing decisions

### 1. Leasing, not scheduling

Two worker instances in the same region, or one instance restarting
mid-tick, must never double-probe a monitor. Due monitors are claimed with:

```sql
SELECT ... FROM "Monitor"
WHERE "active" AND "nextCheckAt" <= now()
ORDER BY "nextCheckAt"
FOR UPDATE SKIP LOCKED
LIMIT $batch
```

`SKIP LOCKED` means a second worker transparently takes the _next_ rows rather
than blocking or duplicating. The lease is released by advancing `nextCheckAt`
inside the same transaction.

### 2. Confirmation thresholds

A single failed probe is far more likely to mean _the prober's_ network blipped
than that the target is down. The verdict machine requires **N consecutive**
failures (default 3) to declare `DOWN`, and **M consecutive** successes (default 2) to declare recovery.

This is also why `Check` and `Incident` are separate concepts: checks are raw
observations, incidents are _conclusions_. Only conclusions page a human, and
only conclusions count against SLA.

### 3. Rollups, not raw scans

`Check` is the only table with unbounded growth — 3 regions × 30s interval × 100
monitors is ~26 million rows/month. Nothing user-facing may scan it.

- Raw `Check` rows: 30-day retention, partitioned by month
- `CheckRollup`: one row per monitor per day, with counts and latency percentiles
- SLA and status-page history read `CheckRollup` and `Incident` only

See [ADR 0003](./adr/0003-rollups-for-sla.md).

## Failure modes

| Failure                         | Behavior                                 | Why                                                     |
| ------------------------------- | ---------------------------------------- | ------------------------------------------------------- |
| One region loses connectivity   | No incident opened                       | Quorum requires ≥2 regions to agree                     |
| Worker crashes mid-tick         | Leases expire, another instance picks up | Lease held in-transaction, released on rollback         |
| Two workers start in one region | No duplicate probes                      | `SKIP LOCKED`                                           |
| Database unreachable            | Status page still serves                 | Cached, separate failure domain                         |
| Target flaps rapidly            | One incident, alerts suppressed          | Flap detector counts transitions per window             |
| Ancestor service down           | One page, not N                          | Dependency DAG rolls descendants into the root incident |
| Alert channel errors            | Retried with backoff, recorded           | `Notification` row tracks delivery state                |

## The status page failure domain

The most common self-inflicted wound in this category is hosting the status page
on the same infrastructure it reports on. When the app goes down, the page that
explains the outage goes down with it — exactly when it is needed.

Uptick's status page:

- reads only pre-computed rollups, never live queries
- is cached with a 30-second revalidation window
- serves the last good snapshot if the database is unreachable

This is a design constraint, not a later optimization.

## Security boundaries

| Boundary           | Threat                                                 | Control                                                                                         |
| ------------------ | ------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| Monitor target URL | **SSRF** — probing cloud metadata or internal services | Resolve DNS, validate the _resolved IP_ against deny-listed ranges, re-check every redirect hop |
| Webhook alert URL  | SSRF via alert delivery                                | Same resolved-IP validation                                                                     |
| Public status page | Enumeration, scraping                                  | Rate limited, only published monitors exposed                                                   |
| API routes         | Authz bypass                                           | Org-scoped queries; never trust a client-supplied org ID                                        |
| Response bodies    | Memory exhaustion                                      | Capped read size                                                                                |

## Technology choices

| Choice     | Reason                                                                     |
| ---------- | -------------------------------------------------------------------------- |
| PostgreSQL | Needs `SKIP LOCKED`, partitioning, and percentiles — all native            |
| Prisma     | Type-safe client; raw SQL where the ORM cannot express the query (leasing) |
| Turborepo  | Task graph + caching across four workspaces                                |
| Vitest     | Fast, ESM-native, good coverage integration                                |
| Railway    | Long-lived processes, multi-region, cheap                                  |
| Vercel     | Next.js hosting with edge caching for the status page                      |
