# syntax=docker/dockerfile:1
# Build from the repository root:
#   docker build -f deploy/backend.Dockerfile \
#     --build-arg BUN_VERSION=<the bun pin in mise.toml> .
ARG BUN_VERSION

FROM oven/bun:${BUN_VERSION}-alpine AS build
WORKDIR /app

# Manifests first, so a source change reuses the installed dependencies. Bun
# checks the lockfile against every workspace, so all of them are present.
COPY package.json bun.lock ./
COPY apps/backend/package.json apps/backend/
COPY apps/frontend/package.json apps/frontend/
COPY packages/core/package.json packages/core/
COPY packages/intelligence/package.json packages/intelligence/
COPY packages/logger/package.json packages/logger/
COPY packages/tsconfig/package.json packages/tsconfig/
COPY packages/types/package.json packages/types/
COPY packages/utils/package.json packages/utils/
RUN bun install --frozen-lockfile --production --filter @vendeya/backend

COPY packages packages
COPY apps/backend apps/backend

FROM oven/bun:${BUN_VERSION}-alpine
WORKDIR /app/apps/backend
COPY --from=build /app /app

# The uploads and private stores and the database sit on the /data volume. The
# volume takes the owner of this directory the first time it is mounted.
RUN mkdir /data && chown bun:bun /data
USER bun
ENV NODE_ENV=production \
    DB_PATH=/data/database.sqlite \
    UPLOAD_DIR=/data/uploads \
    PRIVATE_DIR=/data/private
EXPOSE 3000
CMD ["bun", "src/index.ts"]
