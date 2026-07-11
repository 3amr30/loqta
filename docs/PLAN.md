# Loqta (لقطة) — Implementation Plan

> **For agentic workers:** implement one phase at a time, in order. After each phase: run the phase's verification commands, paste real output, commit (conventional commits), push to `origin main`, report status in two lines. Never claim something works without running it.

**Goal:** Arabic-first multi-tenant dropshipping SaaS — import supplier products by URL, auto-price, publish on `{slug}.loqta.shop`, COD checkout, scheduled supplier sync.

**Architecture:** Fastify API + pg-boss worker (two entries, one backend package) over Supabase Postgres with RLS; two Vite SPAs (dashboard + ultra-light storefront) served by the backend with per-URL OG/JSON-LD injection for WhatsApp/Facebook unfurls; shared pure-TS core (pricing engine, adapter contract, PII scrubber).

**Tech stack:** Node 20, Fastify 5, TypeScript strict, Zod, pg-boss, Playwright, `@google/genai` (gemini-2.5-flash), React 19 + Vite + Tailwind v4 + React Router v7 (library) + TanStack Query + RHF/Zod, Supabase (Postgres/Auth/Storage), Sentry ×3, pnpm workspaces, Vitest, GitHub Actions.

---

## 0. Assumptions

1. **Repo is not yet a git repository.** P0 starts with `git init`, first commit of the existing scaffold **as-is** (preserves `apps/web` in history), then the restructure commit. Remote: `https://github.com/3amr30/loqta.git`, branch `main`.
2. **Existing scaffold is reused per the brief:** migrations `20260711100001–05` and `packages/core` kept unchanged; `apps/worker/src` moves to `backend/src/worker/`; `apps/web` deleted in P0 after its reusable ideas (magic-link flow, `verifyOtp` confirm, SSRF guard, slug regex) are noted here and ported in P1/P2.
3. **One API-surface addition:** `PATCH /v1/stores` (name, logo_url, `settings.shipping_fee`, `sync_policy`). Without it the merchant can never set the flat COD shipping fee or the sync policy that §4 checkout and sync depend on.
4. **Shipping fee lives in `stores.settings` jsonb** (`settings.shipping_fee`, numeric, default 0) — the brief says "per-store flat `shipping_fee` from store settings"; no new column.
5. **Dashboard live job status uses TanStack Query polling** (3s on imports page, 30s on notifications). Supabase Realtime is a later enhancement — polling is simpler, works through the API only, and keeps the frontend/backend contract uniform.
6. **Checkout "validate stock"** = reject items whose listing is not `active` or whose source product / chosen variant is not `active`. No quantity reservation — supplier stock is external and advisory.
7. **FX:** `fx_rates` stays seed-only for MVP (USD→EGP seeded; imports fail loudly on missing pairs — existing behavior). Automated FX refresh is a fast-follow, listed in risks.
8. **Plan/quota enforcement (`plans.max_listings` etc.) is out of MVP scope** — tables exist, enforcement comes with billing.
9. **`image.process`** queue stays wired with the existing resize→webp handler; Supabase Storage upload is a P5 stretch item, not on the DoD critical path.
10. **Storefront ships zero supabase-js** — it talks only to `/v1/public/*` (bundle budget). Dashboard uses supabase-js for auth only; all data goes through the API.
11. **Tests requiring a live DB are out of CI scope.** DB-heavy logic is factored into pure functions (checkout recompute, sync policy decisions, SEO injection, CSV) and unit-tested; live-DB checks happen in per-phase manual verification.
12. **Deploy target:** Railway, two services (api, worker) from one Docker image built off the Playwright base image; `*.loqta.shop` + `app.loqta.shop` wildcard DNS → api service. Supabase `DATABASE_URL` must be the direct/session connection (pg-boss needs it, not the transaction pooler).
13. **Amazon URLs are rejected at import** (explicit blocklist → `UNSUPPORTED_URL`), per §8. AliExpress URLs route to the DS-API adapter which throws `NOT_CONFIGURED` until keys exist — they can never fall through to the scraper.

---

## 1. Architecture

```
                                   ┌───────────────────────────────┐
        app.loqta.shop             │        backend (Fastify)      │
  ┌────────────────────┐  HTTPS    │  src/server.ts                │
  │ frontend/dashboard │──────────▶│  ┌─────────────────────────┐  │
  │  React 19 SPA      │  JWT      │  │ auth plugin (jose:      │  │
  └────────────────────┘           │  │  HS256 + JWKS, cached)  │  │
        {slug}.loqta.shop          │  ├─────────────────────────┤  │
  ┌────────────────────┐  anon     │  │ /v1 merchant routes     │  │
  │ frontend/storefront│──────────▶│  │ /v1/public (rate-limit) │  │
  │  <150KB gz SPA     │           │  │ static-tenants plugin:  │  │
  └────────────────────┘           │  │  app.* → dashboard dist │  │
                                   │  │  {slug}.* → storefront  │  │
     WhatsApp / Facebook ─────────▶│  │  dist + OG/JSON-LD      │  │
     link unfurl (HTML GET)        │  │  injection per URL      │  │
                                   │  └─────────────────────────┘  │
                                   └───────┬───────────────────────┘
                                           │ pg (service role, port 5432)
                     ┌─────────────────────▼──────────────────────┐
                     │  Supabase Postgres (+ Auth/Storage)         │
                     │  public schema: RLS on every table          │
                     │  storefront_* views (anon-safe columns)     │
                     │  pgboss schema: queues                      │
                     └─────────────────────▲──────────────────────┘
                                           │ pg (same pool code)
                                   ┌───────┴────────────────────────┐
                                   │  backend worker src/worker.ts  │
                                   │  pg-boss: import.product,      │
                                   │  sync.tick (*/15, tiered),     │
                                   │  sync.product, content.generate│
                                   │  image.process + 5s sweep of   │
                                   │  import_jobs (SKIP LOCKED)     │
                                   │  adapters: aliexpress(DS API), │
                                   │  generic(JSON-LD→OG);          │
                                   │  Playwright or ScraperAPI      │
                                   └───────┬────────────────────────┘
                                           ▼
                              supplier sites / AliExpress DS API
                              Gemini 2.5 Flash (content rewrite)

  Sentry: dashboard SPA, storefront SPA, backend (server+worker) — shared
  PII scrubber from @loqta/core in every beforeSend.
```

**Trust boundaries (must survive every refactor):**
- `source_products` written only by the worker (service-level pg pool).
- Anon storefront data path: backend → `storefront_stores` / `storefront_listings` / `storefront_listing_variants` views only. `cost_snapshot` never crosses this line.
- `orders` has no public INSERT policy; checkout runs server-side, recomputes every price from the DB, client prices are display-only (the checkout schema doesn't even accept them).
- Profit = snapshots at order time, never live supplier prices.
- Retail prices never change silently: `pause_only` / `auto_apply` / `require_approval` per store; back-in-stock never auto-reactivates.

---

## 2. Complete file map (target state)

```
loqta/
├── .github/workflows/ci.yml            # install → typecheck → test → build ×3 → bundle budget
├── .gitignore                          # existing, + dist/
├── package.json                        # root scripts: dev:*, typecheck, test, build, lint
├── pnpm-workspace.yaml                 # frontend/*, backend, packages/*
├── tsconfig.base.json                  # strict, shared compiler options
├── eslint.config.js                    # flat config, TS + react hooks
├── .prettierrc.json
├── README.md                           # rewritten in P5: setup + Railway/DNS deploy
├── docs/PLAN.md                        # this file
├── scripts/check-bundle-size.mjs       # gzip-sum storefront dist JS, fail > 150KB
│
├── packages/core/                      # pure TS, no runtime deps (unchanged contract)
│   ├── package.json                    # + vitest devDep, "test" script
│   ├── tsconfig.json
│   ├── vitest.config.ts
│   └── src/
│       ├── index.ts                    # + export ./pii
│       ├── pricing/engine.ts           # KEEP AS-IS
│       ├── pricing/engine.test.ts      # NEW: rounding, min_profit, fx, malformed jsonb
│       ├── adapters/types.ts           # KEEP AS-IS
│       └── pii.ts (+ pii.test.ts)      # NEW: scrubPii()/scrubSentryEvent() shared by all 3 Sentry inits
│
├── backend/
│   ├── package.json                    # fastify, @fastify/{cors,rate-limit,static}, jose, zod,
│   │                                   # pg, pg-boss, playwright, cheerio, sharp, @google/genai,
│   │                                   # @supabase/supabase-js, @sentry/node, tsup, vitest, tsx
│   ├── tsconfig.json / tsup.config.ts  # tsup bundles src/server.ts + src/worker.ts → dist/ (core inlined)
│   ├── vitest.config.ts
│   ├── Dockerfile                      # FROM mcr.microsoft.com/playwright:v1.49.1-jammy
│   │                                   # CMD node dist/server.js (worker service overrides CMD → dist/worker.js)
│   ├── .env.example                    # every backend var from §6 of the brief
│   ├── tests/fixtures/                 # saved HTML: jsonld-simple.html, jsonld-graph.html,
│   │                                   # jsonld-aggregate.html, og-only.html, junk.html
│   └── src/
│       ├── config.ts                   # zod-validated process.env, fail-fast
│       ├── server.ts                   # Fastify bootstrap: plugins, routes, static-tenants, Sentry
│       ├── worker.ts                   # pg-boss bootstrap (ported apps/worker/src/index.ts) + Sentry wrap
│       ├── lib/
│       │   ├── db.ts                   # pg Pool + query/queryOne/notify (ported; shared by server & worker)
│       │   ├── sentry.ts               # @sentry/node init + beforeSend(core scrub) + withSentry(queue, handler)
│       │   ├── ssrf.ts (+ ssrf.test.ts)# isSafePublicUrl (ported) + amazon blocklist
│       │   ├── errors.ts               # AppError + error envelope types
│       │   └── supabase.ts             # service-role client (Storage uploads only)
│       ├── plugins/
│       │   ├── auth.ts                 # jose verify: HS256 secret + cached remote JWKS; req.merchantId; requireStore
│       │   ├── error-handler.ts        # consistent {error:{code,message,details}} envelope + Sentry capture
│       │   └── static-tenants.ts       # host router: app.* → dashboard dist, {slug}.* → storefront dist + injection
│       ├── seo/
│       │   ├── inject.ts               # pure: injectStorefrontMeta(html, store, listing?) → html
│       │   └── inject.test.ts          # title/OG/JSON-LD present, HTML-escaped, store-level fallback
│       ├── routes/v1/
│       │   ├── me.ts stores.ts imports.ts listings.ts pricing.ts
│       │   ├── orders.ts notifications.ts stats.ts monitoring.ts
│       │   └── public.ts               # stores/:slug, listings, listing detail, checkout
│       ├── services/
│       │   ├── checkout.ts (+ .test.ts)# pure recompute + tx insert; tamper tests live here
│       │   ├── orders-csv.ts (+ .test.ts) # UTF-8 BOM CSV for Excel-Arabic
│       │   └── stats.ts                # overview SQL
│       └── worker/                     # ported from apps/worker/src (same structure)
│           ├── queues.ts
│           ├── adapters/{index.ts, aliexpress.ts, generic.ts}
│           │                           # generic.ts split: parseProductHtml(html, url) pure (fixture-testable)
│           ├── adapters/generic.test.ts
│           ├── jobs/{import-product.ts, sync.ts, sync-policy.ts (+ .test.ts),
│           │        generate-content.ts, process-image.ts}
│           │                           # sync-policy.ts = pure decision fn extracted from sync.ts
│           └── lib/{browser.ts, politeness.ts (+ .test.ts), fx.ts}
│
├── frontend/dashboard/                 # app.loqta.shop
│   ├── package.json vite.config.ts tsconfig.json index.html .env.example
│   │                                   # index.html: <html lang="ar" dir="rtl">; IBM Plex Sans Arabic (@fontsource)
│   └── src/
│       ├── main.tsx                    # Sentry init → router → QueryClientProvider
│       ├── sentry.ts                   # @sentry/react + browserTracingIntegration + AR ErrorBoundary + core scrub
│       ├── router.tsx                  # RRv7 library mode; Sentry ErrorBoundary at root
│       ├── lib/{supabase.ts, api.ts}   # magic-link auth; fetch wrapper attaching Bearer token
│       ├── pages/{Login, AuthConfirm, Onboarding, Imports, Listings, ListingEdit,
│       │        Orders, OrderDetail, PricingRules, Stats, Settings}.tsx
│       └── components/{Layout, NotificationsBell, ProfitPreview, StatusBadge, ...}.tsx
│
├── frontend/storefront/                # {slug}.loqta.shop — keep tiny (<150KB gz JS)
│   ├── package.json vite.config.ts tsconfig.json index.html .env.example
│   └── src/
│       ├── main.tsx sentry.ts          # anonymous; tunnel via /v1/monitoring
│       ├── router.tsx                  # "/", "/p/:slug", "/cart", "/checkout", "/success/:orderNumber"
│       ├── lib/{store.ts, api.ts, cart.ts}  # hostname→slug (+ ?store= dev fallback); localStorage cart
│       └── pages/{Home, Product, Cart, Checkout, Success}.tsx
│
├── supabase/migrations/
│   ├── 20260711100001_init.sql … 20260711100005_rls.sql   # KEEP AS-IS
│   └── 20260711100006_api_delta.sql    # see §4 below
└── (deleted: apps/web, apps/worker — worker code lives on in backend/src/worker)
```

---

## 3. API contract (v1, JSON, Zod-validated)

Error envelope everywhere: `{ "error": { "code": "SLUG_TAKEN", "message": "…", "details?": [...] } }`. Paginated lists: `{ "data": [...], "meta": { "page", "pageSize", "total" } }`.

### Merchant routes — `Authorization: Bearer <supabase JWT>`; `requireStore` where marked 🏪

| Route | Method | Request (Zod) | Response |
|---|---|---|---|
| `/v1/me` | GET | — | `{ profile, store\|null, plan }` |
| `/v1/stores` | POST | `{ name: string(1–80), slug: /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/ }` (mirrors DB check) | `{ store }` · 409 `SLUG_TAKEN` |
| `/v1/stores` 🏪 | PATCH | `{ name?, logo_url?, sync_policy?: enum, settings?: { shipping_fee?: number≥0 } }` | `{ store }` |
| `/v1/imports` 🏪 | POST | `{ url: string.url }` → SSRF guard + amazon blocklist → insert `import_jobs` | 202 `{ importJob }` · 400 `UNSAFE_URL`/`UNSUPPORTED_URL` |
| `/v1/imports` 🏪 | GET | `?status?&page?` | `{ data: ImportJob[], meta }` |
| `/v1/listings` 🏪 | GET | `?status?&search?&page?` | `{ data: Listing[], meta }` (includes `cost_snapshot`, profit — merchant-only) |
| `/v1/listings/:id` 🏪 | GET | — | `{ listing, variants, sourceProduct: {price, currency, stock_status, last_synced_at} }` |
| `/v1/listings/:id` 🏪 | PATCH | `{ status?: 'active'\|'paused', title_ar?, title_en?, description_ar?, description_en?, images?: string[], retail_price?: number>0 (sets price_mode:'manual'), price_mode?: 'rule' (reprices from rule) }` | `{ listing }` |
| `/v1/listings/:id/ai-rewrite` 🏪 | POST | — | 202 `{ queued: true }` (enqueues `content.generate`) |
| `/v1/pricing-rules` 🏪 | GET | — | `{ rules: PricingRule[] }` |
| `/v1/pricing-rules` 🏪 | PUT | `{ name?, steps: PricingStep[] }` (same union as `packages/core`) → updates default rule | `{ rule }` |
| `/v1/pricing/preview` 🏪 | POST | `{ cost: number>0, currency: string(3) }` | `{ retail, effectiveCost, profit, trace[] }` (runs `computeRetail` from core) |
| `/v1/orders` 🏪 | GET | `?status?&page?&from?&to?` | `{ data: Order[], meta }` |
| `/v1/orders/:id` 🏪 | GET | — | `{ order, items }` |
| `/v1/orders/:id` 🏪 | PATCH | `{ status?: order_status (validated transition), tracking_number?, notes? }` | `{ order }` |
| `/v1/orders/export.csv` 🏪 | GET | `?from?&to?&status?` | `text/csv; charset=utf-8` with BOM |
| `/v1/notifications` 🏪 | GET | `?unread?&page?` | `{ data: Notification[], meta, unreadCount }` |
| `/v1/notifications/read` 🏪 | POST | `{ ids?: uuid[], all?: true }` | `{ updated: number }` |
| `/v1/stats/overview` 🏪 | GET | `?days=30` | `{ totals: {orders, revenue, cost, profit}, daily: [{date, orders, revenue, profit}], topProducts: [{listingId, title, qty, revenue}] }` |

### Public routes — no auth, `@fastify/rate-limit` (60 req/min/IP; checkout 5/min/IP)

| Route | Method | Request | Response |
|---|---|---|---|
| `/v1/public/stores/:slug` | GET | — | `{ store: {name, slug, logo_url, currency, theme, shipping_fee} }` (from `storefront_stores` view) |
| `/v1/public/stores/:slug/listings` | GET | `?page?&pageSize≤48` | `{ data: PublicListing[], meta }` (from `storefront_listings`) |
| `/v1/public/stores/:slug/listings/:listingSlug` | GET | — | `{ listing, variants }` (views only) |
| `/v1/public/stores/:slug/checkout` | POST | `{ customer: {name(2–80), phone: /^01[0-9]{9}$/, governorate: enum(27), address(5–300), notes?}, items: [{listingId: uuid, variantId?: uuid, qty: 1–20}] (1–20 items) }` — **no price fields accepted** | 201 `{ orderNumber, total, shipping_fee }` · 422 `OUT_OF_STOCK`/`LISTING_UNAVAILABLE` |
| `/v1/monitoring` | POST | Sentry envelope passthrough (tunnel; ad-blocker workaround) | 200 |
| `/healthz` | GET | — | `{ ok: true, version }` |

**Checkout recompute (service, unit-tested):** load listings + variants + source stock with the service pool in one query → reject non-active anywhere → `unit_price = variant.retail_price ?? listing.retail_price` (DB values only) → `subtotal = Σ unit_price×qty`, `shipping_fee = store.settings.shipping_fee ?? 0`, `total = subtotal + shipping_fee`, `total_cost = Σ cost_snapshot×qty` → single transaction inserts `orders` + `order_items` (with `unit_cost_snapshot`, `fx_rate_snapshot` copied from the listing) → `notify(store, 'new_order', …)`. Order number comes from the existing DB trigger.

**Auth plugin:** verify with `jose`. Per-token: decode header → `alg === 'HS256'` → `jwtVerify` with `SUPABASE_JWT_SECRET`; asymmetric algs → `createRemoteJWKSet(new URL(SUPABASE_URL + '/auth/v1/.well-known/jwks.json'))` (created once at boot; jose caches keys). Validate `aud: 'authenticated'` and expiry. Attach `request.merchantId = payload.sub`. `requireStore` preHandler loads the caller's store (404 `NO_STORE` if none) onto `request.store`.

**Static tenants + SEO injection:** `static-tenants` plugin inspects `Host`: `app.{ROOT_DOMAIN}` (or `localhost` in dev) → serve `frontend/dashboard/dist`; any other `{slug}.{ROOT_DOMAIN}` → serve `frontend/storefront/dist`, and for HTML navigations run `injectStorefrontMeta(indexHtml, store, listing?)`: sets `<title>`, `og:title/og:description/og:image/og:url/og:type=product`, `product:price:amount` / `product:price:currency`, and a JSON-LD `Product` block (name, image, offers{price, priceCurrency, availability}) before `</head>`, HTML-escaped. Product URLs (`/p/:listingSlug`) get listing data; other paths get store-level tags. 60s in-memory LRU per URL. `/v1/*` and asset paths bypass injection.

---

## 4. DB delta vs existing migrations

Migrations 001–005 already implement the full §3 schema, RLS, views, triggers, and seeds — **kept byte-for-byte**. One new migration:

**`supabase/migrations/20260711100006_api_delta.sql`**

```sql
-- 1. Order tracking (dashboard orders board needs it; no column exists today)
alter table public.orders add column tracking_number text;

-- 2. Variant picker on the public product page — anon-safe columns only,
--    effective retail price resolved here so cost never leaves the DB tier.
create view public.storefront_listing_variants as
  select lv.id, lv.listing_id,
         coalesce(lv.retail_price, l.retail_price) as retail_price,
         sv.title, sv.options, sv.image_url, sv.stock_status
  from public.listing_variants lv
  join public.listings l         on l.id = lv.listing_id and l.status = 'active'
  join public.source_variants sv on sv.id = lv.source_variant_id
  where lv.is_enabled;
grant select on public.storefront_listing_variants to anon, authenticated;

-- 3. Expose the COD shipping fee to the public store endpoint
--    (view recreated with one added column — safe for `create or replace`)
create or replace view public.storefront_stores as
  select id, name, slug, logo_url, currency,
         settings -> 'theme' as theme,
         coalesce((settings ->> 'shipping_fee')::numeric, 0) as shipping_fee
  from public.stores;

-- 4. Notification type for AI rewrite completion
--    (generate-content currently mislabels it as import_done)
alter type public.notification_type add value if not exists 'content_ready';
```

Nothing else changes. The `pgboss` schema is created by pg-boss itself at first worker boot (the direct `postgres` role has CREATE). Applied via `supabase db push` (or the Supabase MCP `apply_migration`).

---

## 5. Phase breakdown

Every phase ends with: `pnpm -r typecheck && pnpm -r test && pnpm -r build` (all green, output pasted), conventional commit(s), `git push origin main`, two-line status.

---

### P0 — Repo hygiene, restructure, CI, Sentry skeleton

**Tasks**
1. `git init` → commit existing scaffold verbatim (`chore: import existing scaffold`) → `git remote add origin https://github.com/3amr30/loqta.git` → push `main`.
2. Restructure: move `apps/worker/src` → `backend/src/worker` (+ Dockerfile → `backend/Dockerfile`), delete `apps/web`, remove `apps/`; update `pnpm-workspace.yaml` to `frontend/*`, `backend`, `packages/*`; new root scripts (`dev:api`, `dev:worker`, `dev:dashboard`, `dev:storefront`, `typecheck`, `test`, `build`, `lint`).
3. Scaffold `backend/` package (deps merged from old worker + fastify/jose/sentry/tsup/vitest; `src/server.ts` = minimal Fastify with `/healthz` only for now; `src/worker.ts` = ported bootstrap, compiling, DB behavior unchanged).
4. Scaffold both Vite apps: React 19 + TS strict + Tailwind v4 (`@tailwindcss/vite`) + RRv7 + TanStack Query (dashboard) + `lang="ar" dir="rtl"` + `@fontsource/ibm-plex-sans-arabic`. Placeholder home routes only.
5. Root tooling: `tsconfig.base.json` (strict, `noUncheckedIndexedAccess`), ESLint flat config + Prettier, Vitest configs in `packages/core` and `backend`.
6. Real first tests. `packages/core`: `pricing/engine.test.ts` — `round_to_ending` (incl. exact-boundary price and `ending=9`), `min_profit` floor, fx conversion, `fx_buffer` raising the profit base, `parsePricingSteps` filtering malformed/NaN/unknown steps. `pii.ts` + `pii.test.ts` — `scrubPii` masks `01[0-9]{9}`, `+20…`, emails; `scrubSentryEvent` strips `customer_name/customer_phone/customer_email/shipping_address/governorate` keys from extras/contexts/breadcrumbs.
7. Sentry skeleton wired in all three surfaces (init modules + `beforeSend` via core scrubber; DSN-less init is a no-op so dev/builds work without env). Release = git SHA in all three: Vite `define` injects `__SENTRY_RELEASE__` from `GITHUB_SHA`/`git rev-parse HEAD` at build time; backend reads the same at startup. Environment tag from `SENTRY_ENVIRONMENT` (backend) / Vite mode (SPAs).
8. `.env.example` ×3 exactly per §6 of the brief; `.gitignore` additions (`dist/`).
9. `.github/workflows/ci.yml`: pnpm cache → install → `pnpm -r typecheck` → `pnpm -r test` → build backend + dashboard + storefront → `node scripts/check-bundle-size.mjs`.

**Files:** everything under §2 marked as scaffolding; no business routes yet.
**Tests:** pricing engine (~10 cases), PII scrubber (~8 cases).
**Verify:** `pnpm install && pnpm -r typecheck && pnpm -r test && pnpm -r build`; `node scripts/check-bundle-size.mjs`; CI green on push.
**Commits:** `chore: import existing scaffold` · `chore: restructure to frontend/backend monorepo` · `feat: pricing + pii tests, sentry skeletons, ci`.

---

### P1 — Migrations applied + backend foundation + worker port

**Tasks**
1. Write migration `…006_api_delta.sql` (§4) and apply all six to the Supabase project (`supabase db push`); verify tables/views/policies with SQL probes (e.g. anon `select` on `listings` fails, on `storefront_listings` succeeds).
2. `config.ts`: Zod schema over `process.env` (all §6 backend vars; optional ones `.optional()`), fail-fast with a readable error.
3. Error handling: `errors.ts` (`AppError(code, status, message)`) + `error-handler.ts` plugin (envelope, Zod issues → `details`, unexpected → Sentry capture with route/store-slug/merchant-id tags, **request bodies never attached**).
4. Auth plugin per §3 spec (HS256 + JWKS dual-path, cached) + `requireStore`. Unit tests with locally-signed HS256 tokens: valid, expired, bad signature, wrong aud.
5. Routes: `GET /v1/me`, `POST /v1/stores`, `PATCH /v1/stores` (slug regex mirrors DB constraint; unique violation → 409 `SLUG_TAKEN`).
6. Worker port made real: `backend/src/worker.ts` runs the existing bootstrap against shared `lib/db.ts`; every pg-boss handler wrapped in `withSentry(queue, handler)` (tags: `queue`, `jobId`, `sourceProductId`/`importJobId`; rethrows so pg-boss still retries); graceful SIGTERM kept.
7. `politeness.ts`: per-host gate — min 5s between fetches to the same host, exponential backoff (30s → 4min → 20min) after 403/429, single in-flight request per host; wired into `browser.ts` `getHtml`. Unit tests with fake timers.
8. **FX staleness guard (approved addition):** `getFxRate` on cross-currency pairs also reads `fetched_at`; if older than 7 days → warn log + Sentry event (tag `fx_stale`) and staleness noted in the import/pricing notification. The seeded USD→EGP placeholder must never silently price a real product once AliExpress keys arrive. Unit test: stale pair triggers the guard, fresh pair and same-currency do not.

**Files:** `backend/src/{config,server,worker}.ts`, `lib/*`, `plugins/{auth,error-handler}.ts`, `routes/v1/{me,stores}.ts`, `worker/lib/politeness.ts`, migration 006.
**Tests:** auth (4), config schema (2), slug/store schemas (3), politeness (3), error envelope shape (2) — via `fastify.inject`, no live DB.
**Verify:** trio + run api locally → `curl localhost:3001/healthz`; `curl -H "Authorization: Bearer <real supabase token>" /v1/me` returns profile; worker boots and creates `pgboss` schema (checked via SQL).
**Commits:** `feat: migration 006 api delta` · `feat: backend foundation (auth, errors, stores) + worker port`.

---

### P2 — Import pipeline end-to-end + dashboard core

**Tasks**
1. `ssrf.ts` ported from the old server action + amazon blocklist (`amazon.*` hostnames → `UNSUPPORTED_URL`). Tests: private ranges (`10.*`, `172.16–31.*`, `192.168.*`, `169.254.*`, `127.*`), `localhost`/`.local`/`.internal`, non-http(s) scheme, `0.0.0.0`, `[::1]`, amazon, happy path.
2. `POST /v1/imports` (guard → insert `import_jobs` with service pool) + `GET /v1/imports` (paginated).
3. Listings routes: `GET /v1/listings`, `GET /v1/listings/:id`, `PATCH /v1/listings/:id` (status/titles/descriptions/images/manual price; `price_mode:'rule'` reprices via core against current `source_products.price` + fx). `POST /v1/pricing/preview` + `GET/PUT /v1/pricing-rules` (step union Zod-validated — malformed steps rejected at the API, not only filtered in core).
4. Refactor `worker/adapters/generic.ts`: extract pure `parseProductHtml(html, url): ScrapedProduct | null`; `fetchProduct` = `getHtml` + parse. Fixture tests: JSON-LD simple / `@graph` / AggregateOffer+variants / OG-only / junk → `PARSE_FAILED`; price-string parsing (`"1,299.00 EGP"`).
5. Dashboard: supabase magic-link login (`signInWithOtp` → `/auth/confirm` page calling `verifyOtp` — ported flow), session context, `api.ts` fetch wrapper (Bearer from supabase session, envelope-aware errors), `Sentry.setUser({ id: merchantId })` after login; onboarding (create store) gate; Imports page (URL form + job list polling 3s, status badges, Arabic error copy); Listings table (publish/pause toggle, thumbnail, price, stock badge); ListingEdit (titles/descriptions/image order, price editor with live `/v1/pricing/preview` profit preview; AI-rewrite button present but disabled until P5). All poll intervals live in `frontend/dashboard/src/lib/constants.ts` — single place for a later Realtime swap.

**Files:** `backend/src/routes/v1/{imports,listings,pricing}.ts`, `lib/ssrf.ts`, `worker/adapters/generic.ts` split + tests + `backend/tests/fixtures/*.html`, dashboard `src/**` per file map.
**Tests:** SSRF (~10), generic adapter fixtures (~8), pricing routes via inject (3), listing PATCH schema (3).
**Verify:** trio; live loop: run api + worker + dashboard dev → login → create store → paste real JSON-LD product URL → import job goes `queued→processing→done` → listing appears priced by the default rule → paste `http://169.254.1.1/x` → 400 `UNSAFE_URL`.
**Commits:** `feat: import pipeline + listings API` · `feat: dashboard core (auth, onboarding, imports, listings)`.

---

### P3 — Storefront + COD checkout + OG injection

**Tasks**
1. Public routes over the views (`storefront_stores` / `storefront_listings` / `storefront_listing_variants`), pagination, 404 envelope; `@fastify/rate-limit` scoped to `/v1/public/*` (60/min; checkout 5/min).
2. `services/checkout.ts`: pure `computeOrder(input, dbRows)` (returns priced order or typed rejection) + thin transaction wrapper. **Tests:** client price fields rejected by schema (`z.strictObject`), qty bounds, OOS variant rejected, paused listing rejected, totals/shipping math, snapshots copied from listing rows, mixed variant/no-variant carts.
3. `POST /v1/public/stores/:slug/checkout` route + merchant `new_order` notification.
4. `seo/inject.ts` + tests (OG/product tags, JSON-LD Product validity, `<`/`"` escaping in Arabic titles, store-level fallback for non-product paths); `static-tenants.ts` plugin (host routing, SPA fallback always serves injected `index.html`, asset cache headers, `/v1` bypass). Dev mode: SPAs on Vite ports with CORS from `CORS_ORIGINS`; production same-origin.
5. Storefront SPA within budget: store resolution (`hostname` → slug, `?store=` dev fallback), Home grid (`loading="lazy"` images), Product page (gallery, variant picker from public variants, add-to-cart), Cart (localStorage, qty edit), Checkout (RHF+Zod: name / phone `01\d{9}` / governorate select (27) / address / notes), Success page with order number. No UI libraries, no supabase-js.
6. `/v1/monitoring` Sentry tunnel; storefront Sentry posts through it.
7. CI bundle-budget step live (fails > 150KB gzip total JS).

**Files:** `routes/v1/{public,monitoring}.ts`, `services/checkout.ts`, `seo/inject.ts`, `plugins/static-tenants.ts`, storefront `src/**`.
**Tests:** checkout (~10), inject (~6), public route shapes via inject (~4).
**Verify:** trio + bundle script output pasted; `curl -H "Host: teststore.loqta.shop" localhost:3001/p/<listing-slug> | grep og:` shows injected tags; full phone-browser COD flow: storefront → cart → checkout → success → order row in DB with correct `total_cost` snapshots; 6 rapid checkouts → 429. After deploy: run the Facebook Sharing Debugger against a live product URL and paste the result like any other verification output.
**Commits:** `feat: public storefront API + COD checkout` · `feat: storefront SPA` · `feat: multi-tenant serving + OG/JSON-LD injection`.

---

### P4 — Sync engine hardening + notifications + orders board

**Tasks**
1. Extract `worker/jobs/sync-policy.ts`: pure `decideSyncActions({policy, priceMode, oldCost, newCost, oldStock, newStock}) → {reprice?, pause?, notifications[]}` consumed by `sync.ts`. Tests: all 3 policies × price-up/down, OOS pauses under **every** policy, back-in-stock notifies but never reactivates, `manual` price_mode never auto-repriced.
2. Confirm ported sync tick behavior (cron `*/15 * * * *`, tier windows 1h/6h/24h, `singletonKey` dedup, retry/backoff, `expireInSeconds`) and the NOT_FOUND→`removed`→pause path; adopt `content_ready` in `generate-content.ts`.
3. `GET /v1/notifications` + `POST /v1/notifications/read`; dashboard NotificationsBell (30s poll, unread count, mark-read on open).
4. Orders API: list w/ filters, detail w/ items, PATCH with transition guard (`pending→confirmed→fulfilled→shipped→delivered`; `cancelled` from pending/confirmed; `returned` from delivered), `export.csv` (UTF-8 BOM; columns: order_number, date, customer, phone, governorate, items, subtotal, shipping, total, cost, profit, status, tracking).
5. Dashboard Orders board: status-grouped list, detail view (items, address, `tel:` phone link), status-advance buttons, tracking-number input, CSV download (fetched with the Bearer token via `api.ts` and saved as a blob — a plain `<a href>` would 401), WhatsApp deep-link `https://wa.me/{supplier.whatsapp_phone}?text=<prefilled Arabic order summary>` grouped per supplier; Settings page (store name / logo URL / `shipping_fee` / `sync_policy` radio with Arabic explanations of the three policies).

**Files:** `worker/jobs/{sync,sync-policy}.ts`, `routes/v1/{orders,notifications}.ts`, `services/orders-csv.ts`, dashboard Orders/OrderDetail/Settings/NotificationsBell.
**Tests:** sync-policy (~10), status transitions (~6), CSV (~4).
**Verify:** trio; live: `update source_products set price = price * 1.2, content_hash = null where id = …` → next tick → policy-correct notification (and repricing under `auto_apply`); same for `stock_status='out_of_stock'` → listing paused + notification; CSV opens in Excel with Arabic intact.
**Commits:** `feat: sync policies + notifications` · `feat: orders board + CSV export + whatsapp fulfillment`.

---

### P5 — AI rewrite + pricing UI + stats + polish

**Tasks**
1. `POST /v1/listings/:id/ai-rewrite` → enqueue `content.generate`; job hardened (Zod-parse the Gemini JSON output instead of blind `JSON.parse` + casts; `content_ready` notification; Sentry-tagged); dashboard button live with "جاري التحسين…" state resolved via the notifications poll.
2. PricingRules page: ordered step editor (add/remove/reorder the 5 step types with Arabic labels), live preview panel (sample-costs table via `/v1/pricing/preview`), save via PUT.
3. `GET /v1/stats/overview` (daily sales/orders/profit from `orders` snapshot columns over `?days`; top products from `order_items`) + Stats page (plain SVG/CSS bars — no chart library).
4. *(Stretch)* `image.process` Storage upload: output → `product-images/{listingId}/{n}.webp` via the service-role Storage client, swap into `listings.images`.
5. README rewrite: quickstart, env var tables, architecture, Railway deploy (two services, one Dockerfile, `dist/server.js` vs `dist/worker.js` CMDs), DNS (`*.loqta.shop` + `app.loqta.shop` → api service), Supabase setup, Sentry setup + source-map upload (Sentry Vite plugin + `@sentry/cli`, both guarded on `SENTRY_AUTH_TOKEN` — builds never fail without it).
6. Full DoD walkthrough (§8 below) executed and transcribed into the final status report.

**Files:** `routes/v1/{listings,stats}.ts`, `services/stats.ts`, `worker/jobs/generate-content.ts`, dashboard PricingRules/Stats, README.
**Tests:** rewrite route enqueue (mocked boss send) (2), stats SQL builder (2), Gemini output schema parse (3).
**Verify:** trio; live AI rewrite on a real listing (Gemini evidence pasted); stats page matches a SQL spot-check; forced `throw` in each surface → three Sentry events with release/environment tags and a scrubbed phone number in the payload.
**Commits:** `feat: ai rewrite + pricing editor + stats` · `docs: production README`.

---

## 6. Quality gates (standing, every phase)

- TypeScript `strict` (+ `noUncheckedIndexedAccess`) in every package; `pnpm -r typecheck` green at every commit.
- Vitest suites named above; `pnpm -r test` green at every commit.
- ESLint + Prettier configured once at root (P0); `pnpm lint` in CI.
- CI runs install → typecheck → test → build ×3 → storefront bundle budget on every push/PR.
- Conventional commits; push to `origin main` at each phase end; `.env*` (except `.env.example`) and `node_modules` never committed.
- Sentry PII rule: every `beforeSend` goes through the `@loqta/core` scrubber; Egyptian phone patterns covered by tests; request bodies never captured.

## 7. Risk register (top 5)

| # | Risk | Impact | Mitigation |
|---|---|---|---|
| 1 | **WhatsApp/FB unfurl breaks** (host routing or OG injection wrong) — the primary sales channel in Egypt | Merchants can't sell | Injection is a pure, unit-tested function; P3 verification includes `curl -H "Host: …"` tag checks and Facebook Sharing Debugger against the deployed URL; SPA fallback always serves injected HTML, never a bare index |
| 2 | **Supplier sites lack JSON-LD/OG or block scraping** → high import failure rate | Core loop feels broken | Two-stage extraction (JSON-LD→OG) tested against fixture variety; clear Arabic failure notifications with the reason; `SCRAPER_API_KEY` transport for blocked sites; per-domain politeness avoids self-inflicted bans; curated platform suppliers reduce dependence on arbitrary URLs |
| 3 | **Supabase JWT key migration** (legacy HS256 → asymmetric JWKS) breaks merchant auth silently | Total dashboard outage | Dual-path verifier keyed on token `alg` with cached JWKS; both paths unit-tested; auth failures surface in Sentry with route tags |
| 4 | **pg-boss vs Supabase connection modes** (transaction pooler incompatible; IPv6/direct-connection quirks on Railway) | Worker dead → no imports, no sync | Require direct 5432 or Supavisor *session* mode, documented in README + `.env.example`; `boss.on('error')` → Sentry; worker heartbeat check added to P4 verification |
| 5 | **PII leaks into Sentry** (phones, names, addresses — in a COD business the phone *is* the customer identity) | Legal/trust damage | Shared scrubber in `@loqta/core` used by all three inits, tested against `01xxxxxxxxx` / `+20…` / emails / customer-field keys; error handler never attaches request bodies; P5 DoD includes inspecting a real captured event |

Watchlist (not top-5): FX staleness (seed-only rate — mitigated by the `fx_buffer` step and fail-loud missing pairs; automated refresh is the first post-MVP task) · Playwright memory on small Railway instances (job batchSize 3; instance sizing documented) · Gemini output drift (Zod-parsed; failure is non-fatal and notified).

## 8. Definition of done (mirror of brief §11)

A merchant can: sign up → create a store → paste a real product URL from a JSON-LD-emitting site → see the priced listing appear → publish it → open the `{slug}` storefront on a phone → a buyer completes a COD checkout → the order shows in the dashboard with correct snapshot profit → supplier price/stock changes trigger the right policy + notification → a thrown error in any surface appears in Sentry with release, environment, and scrubbed PII. CI is green, `main` is pushed, and README documents setup + deploy (Railway via Docker, wildcard DNS `*.loqta.shop` + `app.loqta.shop` → backend).
