# Playwright base image ships Chromium + all system deps (the worker
# scrapes with it; the api shares the image for a single artifact).
# IMPORTANT: keep the tag in sync with "playwright" in backend/package.json.
FROM mcr.microsoft.com/playwright:v1.49.1-jammy

WORKDIR /app
RUN corepack enable

# Monorepo install (build context must be the repo root):
#   docker build -f backend/Dockerfile .
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/core/package.json packages/core/package.json
COPY backend/package.json backend/package.json
COPY frontend/dashboard/package.json frontend/dashboard/package.json
COPY frontend/storefront/package.json frontend/storefront/package.json
RUN pnpm install --frozen-lockfile

COPY . .

# Release tag for Sentry (pass --build-arg GITHUB_SHA=$(git rev-parse HEAD))
ARG GITHUB_SHA
ENV GITHUB_SHA=$GITHUB_SHA
ENV SENTRY_RELEASE=$GITHUB_SHA

# Builds backend (tsup) AND both SPAs - the api serves the SPA dists from
# /app/frontend/*/dist (resolved relative to backend/dist at runtime).
RUN pnpm -r build

# API service. The worker Railway service uses the same image with:
#   CMD node backend/dist/worker.js
CMD ["node", "backend/dist/server.js"]
