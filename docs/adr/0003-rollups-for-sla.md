# ADR 0003 — SLA from incident durations, served from rollups

**Status:** Accepted
**Date:** 2026-08-08

## Context

Two related questions had to be answered together: **how is uptime computed**,
and **what does it read from**.

### How it is computed

The tempting definition is a check ratio:

```
uptime = passedChecks / totalChecks
```

This is wrong, and wrong in a way that only shows up later. Each check
implicitly represents a span of time equal to the monitor's interval. If a
monitor runs at 60s for the first half of the month and 30s for the second, the
second half contributes twice as many samples for the same wall-clock duration,
and the resulting percentage is silently skewed. The same distortion appears
whenever a monitor is paused, a region is added, or checks are missed.

It also cannot express the thing customers actually care about: **how long were
we down**. "99.2% uptime" and "one 5-hour outage" are different statements, and
only the second is actionable.

### What it reads from

`Check` is the only unbounded table in the system — roughly 26 million rows per
month at 100 monitors across 3 regions at 30-second intervals. Any user-facing
query that scans it will be fast in development and unusable in production.

## Decision

**Compute SLA from incident durations:**

```
downtime = Σ (incident.resolvedAt − incident.startedAt)
           − overlap with maintenance windows

uptime%  = (windowSeconds − downtime) / windowSeconds × 100
```

Downtime is measured in seconds of confirmed outage, independent of check
cadence. Maintenance windows are subtracted rather than counted, matching how
SLAs are written contractually.

**Serve everything user-facing from pre-computed aggregates:**

| Table         | Retention                       | Read by                                                |
| ------------- | ------------------------------- | ------------------------------------------------------ |
| `Check`       | 30 days, partitioned by month   | The verdict machine only (recent rows for one monitor) |
| `CheckRollup` | Indefinite, one row/monitor/day | Uptime bars, latency percentiles, charts               |
| `Incident`    | Indefinite                      | SLA, incident history, status page timeline            |

The nightly rollup job is **idempotent** — recomputing a day overwrites rather
than appends — so a failed run is fixed by re-running it.

Retention is implemented as partition drops, not `DELETE`. A `DELETE` of 26
million rows leaves dead tuples that bloat the table and force expensive vacuums;
dropping a partition is effectively instantaneous.

## Consequences

**Positive**

- Uptime numbers stay correct across interval changes, pauses, and region
  additions.
- The status page's 90-day view is a bounded index scan over ~90 rows per
  monitor, regardless of check frequency.
- Contractual SLA reporting (with maintenance exclusions) falls out of the model
  rather than being bolted on.
- Raw storage cost is capped.

**Negative**

- Uptime is only as accurate as incident detection. Confirmation thresholds mean
  a genuine outage shorter than `confirmThreshold × intervalSec` is not counted.
  This is a deliberate trade: it is the same mechanism that prevents alert spam,
  and under-counting sub-90-second blips is preferable to paging on every one.
- Two sources of truth for "was it up" — `Check` rows and `Incident` durations —
  which can diverge if the rollup job and incident records disagree. The rollup
  job is idempotent specifically so divergence is repairable.
- Raw per-check detail is unavailable after 30 days for forensics.

**Alternatives rejected**

- **A time-series database (TimescaleDB, InfluxDB).** Genuinely better at this
  shape of data, but adds an operational dependency for a workload that
  partitioned Postgres handles comfortably at the target scale. Revisit if raw
  retention needs to exceed 30 days.
- **Continuous aggregates instead of a nightly job.** More elegant, but ties the
  design to a specific Postgres extension and removes the ability to trivially
  re-run a single day.
