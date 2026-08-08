# Contributing to Uptick

Thanks for considering a contribution. This document covers everything needed to
get productive.

## Development setup

**Requirements:** Node ≥ 22, pnpm ≥ 10, a PostgreSQL database.

```bash
pnpm install
cp .env.example .env.local
# fill in DATABASE_URL and DIRECT_URL
pnpm db:push
pnpm db:seed
pnpm dev
```

> **Prisma reads `.env`, not `.env.local`.** Before running any `prisma` command
> directly, export the variables into your shell, or you will hit
> `P1012: Environment variable not found: DIRECT_URL`. The `pnpm db:*` scripts
> handle this for you.

> **Never point `--shadow-database-url` at a database with data in it.** Prisma
> wipes the shadow database on every migration. Use a dedicated throwaway branch.

## Repository layout

| Path            | Purpose                                 | Rules                                                              |
| --------------- | --------------------------------------- | ------------------------------------------------------------------ |
| `packages/core` | Verdict SM, ledger, herald, probe logic | **Pure.** No DB, no network, no `Date.now()` — inject time and I/O |
| `packages/db`   | Prisma schema, migrations, seed         | Schema changes always ship with a migration                        |
| `apps/worker`   | Region-scoped probe scheduler           | Owns all I/O against monitored targets                             |
| `apps/web`      | Dashboard + public status page          | Validate every boundary with Zod                                   |

The purity rule for `packages/core` is load-bearing. It's what lets the state
machine, quorum resolver, and SLA math be tested exhaustively without
infrastructure. Keep effects at the edges.

## The gate

Every change must pass, locally and in CI:

```bash
pnpm gate    # type-check && lint && test && build
```

Individual steps:

```bash
pnpm type-check
pnpm lint
pnpm test
pnpm test:coverage
pnpm build
```

## Coding standards

- **TypeScript strict.** `any` is an error — use `unknown` and narrow it.
- **No `.unwrap()`-style shortcuts.** Handle the failure path explicitly.
- **Named exports** over default exports (grep-friendly, refactor-safe).
- **Max 300 lines per file.** Split by responsibility before adding more.
- **Comments explain WHY**, never WHAT. A comment restating the code is noise; a
  comment recording a hidden constraint is valuable.
- **No magic numbers.** Name any literal that needs explaining.
- **Files** are `kebab-case.ts`; types are `PascalCase`; constants are `UPPER_SNAKE_CASE`.

## Testing

- Tests live beside the source: `src/verdict/machine.ts` → `src/verdict/machine.test.ts`.
- Test **behavior**, not implementation. Name tests for what they guarantee:
  `"does not open an incident on a single failed probe"`.
- Table-driven cases for anything with a decision matrix.
- No real network or filesystem in unit tests — stub at the I/O boundary.
- Coverage floor: **80% overall**, **90% for `packages/core`**.

## Branches and commits

```
main      ← production, protected
develop   ← integration, protected
feat/*    ← your work branches from develop
fix/*
docs/*
```

Never commit directly to `main` or `develop`.

Commits follow [Conventional Commits](https://www.conventionalcommits.org/),
enforced by commitlint. Subject line ≤ 72 characters.

```
feat(verdict): add flap detection with suppression window
fix(probes): re-check resolved IP on every redirect hop
docs(adr): record why the worker is not a Vercel cron
```

Allowed scopes: `repo`, `ci`, `docs`, `db`, `core`, `verdict`, `ledger`,
`herald`, `probes`, `worker`, `web`, `status`, `deps`.

**Stage explicit paths.** Use `git add path/to/file`, never `git add -A`, and
check `git diff --cached --name-status` before committing.

## Pull requests

1. Branch from `develop`
2. Make the change, with tests
3. `pnpm gate` green locally
4. Push, open a PR against `develop`
5. CI green
6. Squash-merge and delete the branch

**PR checklist:**

- [ ] Gate passes locally
- [ ] Tests added for new behavior
- [ ] Coverage did not drop
- [ ] Docs updated if behavior or setup changed
- [ ] No secrets, keys, or tokens in the diff
- [ ] Schema changes include a migration

## Adding a dependency

Justify it first — a dependency is a permanent liability. Then check the last
commit date, open CVEs, download counts, license, and bundle impact. Pin exact:

```bash
pnpm add -E some-package@1.2.3
```

Flag any JS dependency adding > 50 KB to the bundle in the PR description.

## Security

Probe targets are user-supplied URLs, which makes SSRF the highest-severity risk
in this codebase. Any change to `packages/core/src/probes` must preserve these
invariants:

- Resolve DNS **first**, then validate the **resolved IP** — validating the
  hostname string is not sufficient
- Re-validate on **every redirect hop**, not just the initial request
- Reject loopback, link-local, private, and unique-local ranges
- Cap redirect count and response body size

Never log secrets, tokens, or full user-supplied URLs with credentials in them.

Report vulnerabilities per [SECURITY.md](./SECURITY.md) — please do not open a
public issue.

## Code of Conduct

Participation is governed by the [Code of Conduct](./CODE_OF_CONDUCT.md).
