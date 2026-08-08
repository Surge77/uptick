# Data model

Every table, why it exists, and how it grows. Schema source of truth:
`packages/db/prisma/schema.prisma`.

## Growth classes

Tables fall into three classes, and the class dictates how they may be queried.

| Class            | Tables                                                                                | Query rule                                                                 |
| ---------------- | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| **Unbounded**    | `Check`                                                                               | Never scanned by user-facing code. 30-day retention, partitioned by month. |
| **Slow-growing** | `CheckRollup`, `Incident`, `IncidentUpdate`, `Notification`, `Annotation`, `AuditLog` | Indexed range queries only.                                                |
| **Config**       | everything else                                                                       | Free to query.                                                             |

## Identity and tenancy

### `User`, `Account`, `Session`, `VerificationToken`

Auth.js v5 adapter models. Not modified beyond the adapter contract.

### `Organization`

The tenancy root. Every monitor, incident, and status page belongs to exactly one
organization. Created automatically on first login.

### `Membership`

Joins `User` to `Organization` with a `role` (`OWNER` / `ADMIN` / `MEMBER`).

> **Authorization rule:** every query is scoped by an org ID derived from the
> _session_, never from a client-supplied parameter. This is the single most
> likely place to introduce a tenancy bug.

## Monitoring configuration

### `Monitor`

What to check and how.

| Field              | Notes                                                     |
| ------------------ | --------------------------------------------------------- |
| `type`             | `HTTP` / `TCP` / `ICMP` / `SSL` / `DNS` / `HEARTBEAT`     |
| `target`           | URL, host:port, or hostname depending on type             |
| `intervalSec`      | How often to probe                                        |
| `timeoutMs`        | Probe abort threshold                                     |
| `degradedMs`       | Latency above this is `DEGRADED` (up, but slow)           |
| `assertions`       | JSON — expected status, body regex, JSON-path, headers    |
| `confirmThreshold` | Consecutive failures required to declare DOWN (default 3) |
| `recoverThreshold` | Consecutive successes required to declare UP (default 2)  |
| `nextCheckAt`      | **Drives the lease query.** Indexed.                      |
| `active`           | Soft disable                                              |

`nextCheckAt` is deliberately denormalized onto the monitor rather than computed
from the last check — it makes the scheduler's hot query a single indexed range
scan.

### `MonitorDependency`

Edges of a directed acyclic graph: `(monitorId, dependsOnId)`.

Exists in the **first migration** despite only being used from Phase 9. Adding a
dependency graph to a flat monitor list later is a migration plus a rewrite of
every incident query — the kind of refactor that kills side projects. Cycles are
rejected at write time.

### `Region`

`slug` (`fra`, `iad`, `sin`), `label`, `active`. One worker (an _eye_) per active
region. Quorum thresholds are computed against the count of active regions.

### `MaintenanceWindow`

Planned downtime. Suppresses alerting **and** is subtracted from SLA
calculations. Supports one-off windows and an RRULE for recurring windows.

### `SloTarget`

`objective` (e.g. `99.9`) and `windowDays` per monitor. Drives error-budget and
burn-rate alerting. Present from the first migration for the same reason as the
DAG.

## Observations

### `Check` — the only unbounded table

One row per probe, per region.

| Field                                   | Notes                                                                |
| --------------------------------------- | -------------------------------------------------------------------- |
| `monitorId`, `regionId`, `ts`           | Composite index; `ts` is the partition key                           |
| `ok`                                    | Did the probe satisfy all assertions                                 |
| `statusCode`, `latencyMs`, `error`      |                                                                      |
| `dnsMs`, `connectMs`, `tlsMs`, `ttfbMs` | Phase breakdown — lets a slowdown be _attributed_, not just observed |

**Volume:** 100 monitors × 3 regions × 30s ≈ 26M rows/month. Partitioned by month
so retention is a partition drop rather than a `DELETE` that bloats the table.

Prisma cannot express declarative partitioning, so the `PARTITION BY RANGE ("ts")`
clause and two helper functions are hand-written at the end of `0_init`:

| Function                                     | Purpose                                                                                                                       |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `uptick_ensure_check_partition(at)`          | Creates the monthly partition covering `at` if absent. Idempotent, so the worker may call it every tick without coordination. |
| `uptick_prune_check_partitions(retain_days)` | Drops partitions entirely older than the cutoff and returns their names.                                                      |

A `Check_default` partition guarantees inserts never fail on a missing range.
Rows landing there are a signal that the ensure-partition job has stopped running.

Two consequences of partitioning are worth knowing:

- The primary key is `(id, ts)`, not `id`. Postgres requires the partition key to
  participate in every unique constraint on a partitioned table.
- `id` defaults to `uuidv7()` (native in Postgres 18) rather than `cuid()`.
  Version-7 UUIDs sort by creation time, so index inserts stay append-only
  instead of scattering random writes across the B-tree.

### `CheckRollup`

One row per monitor per day: `upCount`, `totalCount`, `p50`, `p95`, `p99`,
`minMs`, `maxMs`. Every user-facing uptime number reads this table.

Rebuilt nightly and idempotent — a re-run for the same day overwrites rather than
appends, so a failed job can simply be retried.

## Conclusions

### `Incident`

A **conclusion**, not an observation. Opened when the verdict machine confirms a
state change with quorum; closed when recovery is confirmed.

| Field                     | Notes                                                            |
| ------------------------- | ---------------------------------------------------------------- |
| `startedAt`, `resolvedAt` | Duration is the unit of SLA accounting                           |
| `severity`                | `DEGRADED` / `DOWN`                                              |
| `cause`                   | Human-readable summary from the failing assertion                |
| `ackedAt`, `ackedById`    | Stops escalation                                                 |
| `parentIncidentId`        | Set when rolled up into an ancestor's incident (DAG suppression) |
| `isFlapping`              | Alerting suppressed while true                                   |

> **SLA is computed from incident durations, never from a check pass ratio.** A
> ratio silently produces wrong answers the moment a monitor's interval changes
> mid-period, because each check implicitly represents a different span of time.

### `IncidentUpdate`

Append-only timeline: `INVESTIGATING` → `IDENTIFIED` → `MONITORING` → `RESOLVED`,
with body text. Drives the public status page narrative.

### `Annotation`

Point-in-time events overlaid on charts: deploys, config changes, manual notes.
`kind`, `label`, `meta` JSON, optional `monitorId`. Populated by Vercel and GitHub
Actions webhooks in Phase 9 to enable deploy correlation.

## Delivery

### `NotificationChannel`

`type` (`EMAIL` / `SLACK` / `DISCORD` / `WEBHOOK`), `config` JSON, `verified`.
Webhook URLs are validated against the same SSRF deny-list as probe targets.

### `Notification`

One row per delivery attempt.

`dedupeKey` is unique and derived from **the incident state transition**, not the
check. This is what makes "10 consecutive failures produce exactly 1 alert" a
database-enforced invariant rather than an application convention.

## Publication

### `StatusPage`

`slug`, `orgId`, `monitorIds`, branding, `customDomain`, `isPublic`,
`passwordHash` for private pages.

### `StatusPageSubscriber`

`email`, `verifiedAt`, `unsubscribeToken`. Double opt-in required.

## Join and support tables

### `Heartbeat`

Push-based dead man's switch, one per `HEARTBEAT` monitor. Holds the secret
`token` the job pings, a `graceSec` tolerance, and `lastPingAt`. The alert
condition is silence: no ping within `graceSec` of the last one.

### `MonitorChannel`

Many-to-many join between `Monitor` and `NotificationChannel`. Composite primary
key, so a monitor cannot be linked to the same channel twice.

### `StatusPageItem`

Which monitors a status page publishes, with `displayName`, `group`, and
`position`. Publication is explicit and opt-in — a monitor is never exposed on a
public page merely by existing.

## Audit

### `AuditLog`

`actorId`, `action`, `targetType`, `targetId`, `meta`, `createdAt`. Append-only;
never updated or deleted.

## Indexing summary

| Table          | Index                             | Serves                                                  |
| -------------- | --------------------------------- | ------------------------------------------------------- |
| `Monitor`      | `(active, nextCheckAt)`           | The scheduler lease query — hottest query in the system |
| `Check`        | `(monitorId, ts DESC)`            | Recent-results fold for the verdict machine             |
| `Check`        | `(monitorId, regionId, ts DESC)`  | Per-region quorum evaluation                            |
| `CheckRollup`  | `(monitorId, day)` unique         | Uptime bars, SLA                                        |
| `Incident`     | `(monitorId, startedAt DESC)`     | Incident lists, SLA duration sums                       |
| `Incident`     | `(resolvedAt)` partial where null | "Currently open" lookups                                |
| `Notification` | `(dedupeKey)` unique              | At-most-once delivery                                   |
