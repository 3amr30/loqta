# لقطة — Loqta

Arabic-first, multi-tenant dropshipping SaaS for Egypt & MENA.
A merchant pastes a supplier product URL → Loqta imports it, prices it by
the merchant's margin rules, publishes it on `{slug}.loqta.shop`, keeps
supplier price/stock in sync, and takes **Cash-on-Delivery** orders.

## Architecture

```
frontend/dashboard    React 19 SPA - merchant dashboard (app.loqta.shop)
frontend/storefront   React 19 SPA - buyer storefront, <150KB initial JS
backend               Fastify API (src/server.ts) + pg-boss worker (src/worker.ts)
packages/core         pure TS: pricing engine, adapter contract, PII scrubber
supabase/migrations   full SQL schema + RLS (17 tables, storefront views)
```

- **One backend serves everything**: `app.{ROOT_DOMAIN}` → dashboard dist,
  `{slug}.{ROOT_DOMAIN}` → storefront dist with per-URL OpenGraph + JSON-LD
  injection (WhatsApp/Facebook unfurls — the primary sales channel).
- **Shared catalog**: one supplier URL = one `source_products` row, synced
  once regardless of how many merchants list it. Merchants own `listings`
  on top with their own prices/content.
- **COD checkout** recomputes every price server-side from the DB; the
  request schema cannot even carry a price field.
- **Profit = order-time snapshots** (`unit_cost_snapshot`,
  `fx_rate_snapshot`) — never live supplier prices (EGP volatility).
- **Sync policies** per store: `pause_only` (default), `auto_apply`,
  `require_approval`. Out-of-stock pauses under every policy;
  back-in-stock never auto-reactivates.

## Quickstart (local)

Requirements: Node 20+, pnpm 9 (`npm i -g pnpm@9`), a Supabase project.

```bash
pnpm install
npx playwright install chromium          # scraper browser (once)

# 1. Apply migrations to your Supabase project, in filename order 001 -> 010
#    (supabase CLI: supabase link && supabase db push, or paste each SQL
#     file from supabase/migrations/ in order)
#
#    POSTGRES 17 TRAP: migration 001 creates `language sql` helpers
#    (is_store_owner, is_admin) that reference tables created in 002.
#    PG17 validates function bodies at creation, so a plain apply FAILS.
#    Prefix the session (or just 001) with:
#        set check_function_bodies = off;
#    The repo files are intentionally left unmodified; this is an
#    apply-time setting only.
#
#    Order matters beyond numbering: 007 adds stores.whatsapp_phone, which
#    the 008 storefront_stores view selects. 009 and 010 both ALTER orders
#    but with disjoint columns (whatsapp_confirmation_* vs discount_*).

# 2. Environment
cp backend/.env.example backend/.env                       # fill in
cp frontend/dashboard/.env.example frontend/dashboard/.env # fill in
cp frontend/storefront/.env.example frontend/storefront/.env

# 3. Run (three terminals)
pnpm dev:api          # Fastify on :3001
pnpm dev:worker       # pg-boss worker (imports + sync)
pnpm dev:dashboard    # Vite on :5173
pnpm dev:storefront   # Vite on :5174  (open with ?store=<slug>)
```

Verify: `pnpm -r typecheck && pnpm -r test && pnpm -r build`,
then `node scripts/check-bundle-size.mjs` (storefront budget gate).

### DATABASE_URL — read this or the worker won't start

pg-boss needs a **direct/session** Postgres connection, never the
transaction pooler. On IPv4-only networks (most home ISPs, Railway) the
direct host `db.<ref>.supabase.co` does NOT resolve (it is IPv6-only).
Use the Supavisor **session** pooler instead:

```
postgresql://postgres.<PROJECT_REF>:<PASSWORD>@aws-0-<REGION>.pooler.supabase.com:5432/postgres
```

Find the exact host under Supabase → Settings → Database → "Session mode".

## Environment variables

| backend/.env | required | notes |
|---|---|---|
| `DATABASE_URL` | ✔ | session pooler, see above |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | ✔ | server-only, never in git |
| `SUPABASE_JWT_SECRET` | legacy | HS256 projects only; JWKS auto-detected otherwise |
| `PORT`, `ROOT_DOMAIN`, `CORS_ORIGINS` | ✔ | prod is same-origin; CORS is for Vite dev |
| `GEMINI_API_KEY` | for AI rewrite | Google AI Studio |
| `SCRAPER_API_KEY` | optional | fallback transport for bot-shielded sites |
| `ALIEXPRESS_APP_KEY/SECRET` | optional | official Dropshipping API (never scraped) |
| `SENTRY_DSN`, `SENTRY_ENVIRONMENT` | recommended | |
| `IMPORT_SWEEP_MS`, `SYNC_BATCH_SIZE` | defaults ok | |

Frontends: `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` (dashboard only),
`VITE_API_URL` (empty in prod = same origin), `VITE_SENTRY_DSN`.

Real values live ONLY in `.env` files (gitignored). `.env.example` stays
placeholders.

## Deploy (Railway + wildcard DNS)

One Docker image, two Railway services:

```bash
docker build -f backend/Dockerfile --build-arg GITHUB_SHA=$(git rev-parse HEAD) .
```

| service | start command | needs |
|---|---|---|
| `loqta-api` | `node backend/dist/server.js` (image default) | all backend env vars, public networking |
| `loqta-worker` | `node backend/dist/worker.js` | same env vars, no public networking |

DNS (points at `loqta-api`):

```
app.loqta.shop      CNAME  <railway api domain>
*.loqta.shop        CNAME  <railway api domain>
```

Add both `app.loqta.shop` and `*.loqta.shop` as custom domains on the api
service so Railway issues certificates for them.

After first deploy: share a product link in WhatsApp and check the unfurl,
then validate with the [Facebook Sharing Debugger](https://developers.facebook.com/tools/debug/).

## Sentry

All three surfaces init Sentry with `release = git SHA` and environment
tags. **PII scrubbing is mandatory and shared**: every `beforeSend` runs
`@loqta/core`'s scrubber (Egyptian phone patterns, emails, `customer_*`
keys). Request bodies are never attached. The storefront loads the SDK as
a lazy chunk (early errors are buffered and flushed) and can tunnel
through `POST /v1/monitoring` so ad-blockers don't eat events.

Source maps upload only when `SENTRY_AUTH_TOKEN` is set (plus
`SENTRY_ORG` / `SENTRY_PROJECT`): the Vite builds pick it up
automatically; for the backend run
`npx @sentry/cli sourcemaps inject backend/dist && npx @sentry/cli sourcemaps upload backend/dist`
in the deploy pipeline. Builds never fail without the token.

## Testing

```bash
pnpm -r test    # vitest: pricing engine, PII scrubber, SSRF guard,
                # adapter HTML fixtures, checkout recomputation (tamper),
                # sync-policy matrix, order transitions, CSV, SEO injection
pnpm lint
```

CI (`.github/workflows/ci.yml`) runs install → lint → typecheck → test →
build ×3 → storefront bundle budget on every push/PR.

## Security invariants (do not break in refactors)

- `source_products` is written only by the worker (service role).
- Anonymous storefront traffic reads only the `storefront_*` views —
  `cost_snapshot` never crosses that line.
- `orders` has no public INSERT policy; checkout is server-side only.
- Import URLs pass an SSRF guard (private ranges blocked) and platform
  policy (no Amazon; AliExpress via the official API only, never scraped).
- The scraper is polite per host: 5s spacing, exponential backoff on
  403/429. No proxy farms, no watermark removal.
