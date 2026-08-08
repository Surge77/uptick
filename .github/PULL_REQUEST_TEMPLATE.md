## What changed

<!-- One or two sentences. What does this PR do? -->

## Why

<!-- The problem this solves. Link the issue if there is one: Closes #123 -->

## How to verify

<!-- Concrete steps a reviewer can follow to confirm this works. -->

1.
2.

## Checklist

- [ ] `pnpm gate` passes locally (type-check, lint, test, build)
- [ ] Tests added or updated for the new behavior
- [ ] Coverage did not drop
- [ ] Docs updated if setup or behavior changed
- [ ] No secrets, keys, or tokens in the diff
- [ ] Schema changes include a migration
- [ ] Conventional commit messages, subject ≤ 72 chars

## Security

- [ ] This PR does **not** touch probe targets, webhook URLs, auth, or org scoping

<!-- If unchecked, describe the security impact and confirm a review was done.
     Reminder: SSRF controls must validate the RESOLVED IP on EVERY redirect hop. -->
