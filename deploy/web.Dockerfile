# syntax=docker/dockerfile:1
# Build from the repository root:
#   docker build -f deploy/web.Dockerfile \
#     --build-arg BUN_VERSION=<the bun pin in mise.toml> .
ARG BUN_VERSION

FROM oven/bun:${BUN_VERSION}-alpine AS build
WORKDIR /app

COPY package.json bun.lock ./
COPY apps/backend/package.json apps/backend/
COPY apps/frontend/package.json apps/frontend/
COPY packages/core/package.json packages/core/
COPY packages/intelligence/package.json packages/intelligence/
COPY packages/logger/package.json packages/logger/
COPY packages/tsconfig/package.json packages/tsconfig/
COPY packages/types/package.json packages/types/
COPY packages/utils/package.json packages/utils/
RUN bun install --frozen-lockfile

COPY packages packages
COPY apps/frontend apps/frontend
RUN bun run --cwd apps/frontend build

# The build bundles every dependency, so the server needs nothing but its output.
FROM oven/bun:${BUN_VERSION}-alpine
WORKDIR /app
COPY --from=build /app/apps/frontend/dist ./

USER bun
ENV NODE_ENV=production
EXPOSE 3000
CMD ["bun", "index.js"]
