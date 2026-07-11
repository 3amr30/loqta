# Playwright base image ships Chromium + all system deps.
# IMPORTANT: keep this tag in sync with the "playwright" version in package.json.
FROM mcr.microsoft.com/playwright:v1.49.1-jammy

WORKDIR /app
RUN corepack enable

# Monorepo install (build context must be the repo root):
#   docker build -f apps/worker/Dockerfile .
COPY pnpm-workspace.yaml package.json ./
COPY packages/core/package.json packages/core/package.json
COPY apps/worker/package.json apps/worker/package.json
RUN pnpm install --no-frozen-lockfile

COPY packages/core packages/core
COPY apps/worker apps/worker

CMD ["pnpm", "--filter", "@loqta/worker", "start"]
