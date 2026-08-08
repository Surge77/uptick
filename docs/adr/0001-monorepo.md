# ADR 0001 — pnpm monorepo with a pure core package

**Status:** Accepted
**Date:** 2026-08-08

## Context

Uptick needs two deployable units — a Next.js web app and a long-lived probe
worker — that share a database schema and a substantial amount of decision logic
(the verdict state machine, SLA math, quorum resolution, alert dedup).

Three structures were considered:

1. **Two separate repositories.** The schema and shared logic would have to be
   duplicated or published as a private package. Every schema change becomes a
   cross-repo, version-skewed release.
2. **One Next.js app with the worker as a script inside it.** Simple, but the
   worker would carry the entire Next.js dependency tree, and there would be no
   structural barrier keeping database access out of the decision logic.
3. **A pnpm workspace monorepo** with `apps/*` and `packages/*`.

## Decision

Use a pnpm workspace monorepo with Turborepo for task orchestration:

```
apps/web        Next.js 16 → Vercel
apps/worker     Node scheduler → Railway
packages/db     Prisma schema + client
packages/core   Pure decision logic
```

`packages/core` is constrained to be **pure**: no database access, no network, no
reads of the ambient clock. Time and I/O results are passed in as arguments.

## Consequences

**Positive**

- One schema, one migration history, atomic changes across web and worker.
- The purity constraint on `core` means the hardest logic in the system — flap
  detection, quorum, SLA over maintenance windows — is testable as pure functions
  with no infrastructure. This is where the coverage target is actually met, and
  it is the main reason for the split.
- The worker deploys without Next.js in its dependency tree.
- Turborepo caches per-package tasks, so CI only rebuilds what changed.

**Negative**

- Two deploy targets to configure and monitor.
- Vercel needs explicit root-directory and build-command configuration for a
  monorepo.
- Contributors face more structure up front than a single app would require.

**Neutral**

- The purity rule needs enforcement by review; there is no lint rule for "does
  not import the database". If this erodes, the testing advantage erodes with it.
