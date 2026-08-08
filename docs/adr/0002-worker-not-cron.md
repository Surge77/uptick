# ADR 0002 — A long-lived worker, not serverless cron

**Status:** Accepted
**Date:** 2026-08-08

## Context

Something must probe monitored targets on a schedule. The obvious serverless
option was a Vercel Cron route hitting `/api/cron/tick`, keeping the whole
product on one deploy target.

That option fails on four counts:

1. **Minimum interval is 1 minute.** Competitors offer 30-second and even
   10-second checks. A 60-second floor caps the product below table stakes.
2. **Firing is best-effort.** Vercel does not guarantee cron invocation. A
   monitoring product that silently skips checks is worse than no product,
   because the resulting uptime figure is quietly wrong.
3. **Execution time caps fan-out.** A single invocation must probe every due
   monitor within the function timeout. This bounds scale in a way that is
   invisible until it starts truncating.
4. **No stable regional identity.** Multi-region quorum — the feature that
   prevents false-positive outages — requires probes from known, distinct
   network locations. Serverless regions are not controllable this way.

## Decision

Run `apps/worker` as a long-lived Node process on Railway, one instance per
region, each identified by a `REGION` environment variable.

The worker ticks every 10 seconds and claims due monitors with a database lease:

```sql
SELECT ... FROM "Monitor"
WHERE active AND "nextCheckAt" <= now()
ORDER BY "nextCheckAt"
FOR UPDATE SKIP LOCKED
LIMIT $batch
```

`FOR UPDATE SKIP LOCKED` is the core of the design. A second worker instance —
whether from a rolling deploy, a crash-restart overlap, or deliberate horizontal
scaling — transparently claims the _next_ unlocked rows instead of blocking or
duplicating work. The lease is released by advancing `nextCheckAt` in the same
transaction, so a crashed worker's rollback returns its monitors to the pool
automatically, with no reaper process and no lease-expiry bookkeeping.

## Consequences

**Positive**

- True sub-minute intervals; the tick rate is a configuration value, not a
  platform limit.
- Multi-region quorum becomes possible, which is the product's main
  differentiator.
- Concurrency is controlled explicitly with a pool rather than bounded by an
  opaque function timeout.
- Connection reuse across ticks; no per-invocation cold start or connection churn.

**Negative**

- A second hosting provider and deploy pipeline to maintain.
- The worker must handle its own lifecycle: graceful shutdown, backpressure,
  structured logging, and self-monitoring.
- Idle cost is continuous rather than per-invocation.

**Risks**

- The `SKIP LOCKED` guarantee depends on the lease query running **inside** a
  transaction alongside the `nextCheckAt` advance. A refactor that moves either
  half out of the transaction breaks correctness silently — no error, just
  duplicate probes. This is called out in the runbook and must be preserved in
  review.
