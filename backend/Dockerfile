# Playwright base image ships Chromium + all system deps.
# IMPORTANT: keep this tag in sync with the "playwright" version in backend/package.json.
FROM mcr.microsoft.com/playwright:v1.49.1-jammy

WORKDIR /app
RUN corepack enable

# Monorepo install (build context must be the repo root):
#   docker build -f backend/Dockerfile .
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/core/package.json packages/core/package.json
COPY backend/package.json backend/package.json
RUN pnpm install --frozen-lockfile

COPY packages/core packages/core
COPY backend backend
RUN pnpm --filter @loqta/backend build

# API service. The worker Railway service uses the same image with:
#   CMD node backend/dist/worker.js
CMD ["node", "backend/dist/server.js"]
