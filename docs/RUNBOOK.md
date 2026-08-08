# Runbook

Operational procedures for Uptick.

## Environments

| Environment | Web              | Worker                          | Database         |
| ----------- | ---------------- | ------------------------------- | ---------------- |
| Local       | `localhost:3000` | local process, `REGION=local`   | Neon dev branch  |
| Production  | Vercel           | Railway, one service per region | Neon main branch |

## Deploy

### Web (Vercel)

Merging to `main` triggers an automatic production deploy. Preview deploys are
created for every PR.

```bash
vercel --prod        # manual deploy if needed
```

### Worker (Railway)

One Railway service per region, each with `REGION` set to the matching
`Region.slug`. Deploys on push to `main`.

```bash
railway up --service eye-fra
```

**Deploy order matters when a migration is involved:** apply the migration first,
then deploy the worker, then the web app. Migrations must be
backwards-compatible for one release so a rolling deploy never runs old code
against a new schema.

### Migrations

```bash
pnpm db:migrate           # generate + apply in development
pnpm --filter @uptick/db exec prisma migrate deploy   # production
```

> Prisma reads `.env`, not `.env.local`. Export `DATABASE_URL` and `DIRECT_URL`
> into the shell before invoking `prisma` directly.

> **Never** point `--shadow-database-url` at a database containing data. Prisma
> wipes it on every migration.

## Rollback

| What broke      | Action                                                                                                 |
| --------------- | ------------------------------------------------------------------------------------------------------ |
| Web deploy      | Vercel dashboard → previous deployment → _Promote to Production_ (instant)                             |
| Worker deploy   | `railway rollback --service eye-<region>`                                                              |
| Migration       | Migrations are forward-only. Write a new compensating migration; do not hand-edit `_prisma_migrations` |
| Bad alert storm | Disable the affected `NotificationChannel`, or set `Monitor.active = false`                            |

## Common incidents

### Alerts firing for a target that is actually up

1. Check per-region results — is only one region failing?
   ```sql
   SELECT r.slug, c.ok, c.error, c.ts
   FROM "Check" c JOIN "Region" r ON r.id = c."regionId"
   WHERE c."monitorId" = $1
   ORDER BY c.ts DESC LIMIT 20;
   ```
2. If a single region is failing, quorum should already have prevented the
   incident. If an incident opened anyway, the active-region count is wrong —
   verify no region is stuck marked `active` while its worker is dead.
3. If all regions fail, the target genuinely is unreachable from the internet
   even though it works from your machine. Check DNS and firewall rules.

### No checks are being recorded

1. Is the worker alive? Railway → service → _Logs_. Every tick logs a summary.
2. Are monitors due?
   ```sql
   SELECT id, name, "nextCheckAt", now() - "nextCheckAt" AS overdue
   FROM "Monitor" WHERE active ORDER BY "nextCheckAt" LIMIT 20;
   ```
   Growing `overdue` means the worker is down or the pool is saturated.
3. Are leases stuck? A crashed worker rolls back its transaction and releases
   locks automatically. Persistent locks indicate a hung connection:
   ```sql
   SELECT pid, state, query_start, left(query, 80)
   FROM pg_stat_activity WHERE state <> 'idle' ORDER BY query_start;
   ```

### Duplicate probes

Should be impossible via `FOR UPDATE SKIP LOCKED`. If observed, verify the lease
query still runs **inside** a transaction with the `nextCheckAt` advance — an
autocommit refactor breaks the guarantee silently.

### Status page is stale

It serves cached rollups with a 30-second revalidation. Data older than a day
means the nightly `ledger` job failed. It is idempotent — re-run for the affected
day.

### Notification not delivered

```sql
SELECT * FROM "Notification"
WHERE "incidentId" = $1 ORDER BY "createdAt" DESC;
```

No row → suppression fired (maintenance window, flapping, or DAG rollup — all
expected behavior). Row present with an error → channel misconfigured or the
provider rejected it.

### Check table growing too large

```sql
SELECT pg_size_pretty(pg_total_relation_size('"Check"'));
```

Retention drops partitions older than 30 days. If growth is unbounded, the
retention job is not running — check the worker's nightly job log.

## Routine maintenance

| Task                   | Cadence   | Notes                                                  |
| ---------------------- | --------- | ------------------------------------------------------ |
| Rollup + retention job | Nightly   | Idempotent, safe to re-run                             |
| Dependency audit       | Monthly   | `pnpm audit`                                           |
| Neon branch cleanup    | Monthly   | Delete stale dev branches                              |
| Restore drill          | Quarterly | Restore a Neon backup into a scratch branch and verify |

## Adding a region

1. Insert a `Region` row with `active = false`
2. Create the Railway service with `REGION=<slug>`
3. Deploy and confirm checks are being written
4. Set `active = true`

Quorum thresholds recompute from the active region count, so activating a region
changes alerting behavior — do it deliberately, not during an incident.

## Emergency: silence everything

```sql
UPDATE "NotificationChannel" SET enabled = false;
```

Or create a maintenance window covering all monitors. Prefer the window — it is
scoped, time-boxed, and correctly excluded from SLA.
