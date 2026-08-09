# Worker image. Build context is the repository root:
#   docker build -f apps/worker/Dockerfile .
#
# Two stages: the builder holds the full workspace and dev toolchain; the
# runtime copies the workspace with its built dist/ and generated Prisma
# client. The whole workspace ships rather than a pruned bundle because
# @uptick/db resolves its engine binary from packages/db/generated at
# runtime — pnpm's deploy pruning drops it (it is not in the package's
# `files` list) and a missing engine only surfaces on first query.

FROM node:22-slim AS build

# Prisma's engine needs OpenSSL; slim images do not carry it.
RUN apt-get update -qq && apt-get install -y -qq --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

RUN corepack enable

WORKDIR /repo

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json tsconfig.base.json ./
COPY packages ./packages
COPY apps/worker ./apps/worker

RUN pnpm install --frozen-lockfile --filter @uptick/worker... \
  && pnpm --filter @uptick/db generate \
  && pnpm --filter @uptick/db build \
  && pnpm --filter @uptick/core build \
  && pnpm --filter @uptick/worker build

FROM node:22-slim AS runtime

RUN apt-get update -qq && apt-get install -y -qq --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && groupadd -r worker && useradd -r -g worker worker

WORKDIR /repo

COPY --from=build /repo ./

ENV NODE_ENV=production

USER worker

CMD ["node", "apps/worker/dist/main.js"]
