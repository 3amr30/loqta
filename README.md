# لقطة — Loqta

**Arabic-first dropshipping SaaS for Egypt & MENA.** A merchant pastes a supplier product URL → Loqta scrapes/imports it, prices it with the merchant's margin rules, publishes it on their own storefront (`{slug}.loqta.shop`), keeps supplier price & stock in sync, and handles COD-first checkout.

Built around three decisions:

1. **Local suppliers are first-class** (the Taager model) — AliExpress→Egypt dropshipping breaks on shipping time, customs, and COD. Local suppliers ship in days and COD works.
2. **COD-first checkout** — solves the multi-tenant payment onboarding problem on day one. Merchant-owned Paymob/Stripe keys come later.
3. **Shared source catalog** — one supplier URL = one `source_product`, synced once, no matter how many merchants list it. Each merchant owns a `listing` on top of it.

## Architecture

```
apps/web      Next.js 15 (App Router) — dashboard + multi-tenant storefronts
              {slug}.loqta.shop → middleware rewrite → /s/{slug}
apps/worker   Node + Playwright + pg-boss — scraping, sync, AI, images
              (Docker → Railway/Fly/VPS; headless Chromium can't live on Vercel)
packages/core Shared pure logic: pricing engine + adapter contract
supabase/     Postgres migrations: schema, RLS, views, storage buckets
```

```
Dashboard ──insert──▶ import_jobs ──sweep (5s)──▶ pg-boss ──▶ adapter
                                                              │ aliexpress (DS API)
                                                              │ generic (JSON-LD/OG)
                                                              ▼
                     listings ◀──price via @loqta/core── source_products
                        ▲                                      ▲
                   storefront view                    sync.tick (*/15m, tiered)
```

**Data flow guarantees**

- `source_products` are written **only** by the worker (service role). Merchants read them via RLS.
- The public storefront reads **only** `storefront_stores` / `storefront_listings` views — `cost_snapshot` (the merchant's cost) is never exposed to anon.
- Orders have **no public INSERT policy**: checkout (Phase 1) runs server-side with the admin client and re-validates every price from the DB.
- Profit reporting uses **cost snapshots at order time** (`order_items.unit_cost_snapshot`, `fx_rate_snapshot`) — never live supplier prices. EGP moves; snapshots don't.

## Quickstart

```bash
# 0. prerequisites: Node 20+, pnpm 9, a Supabase project, Supabase CLI

# 1. install
pnpm install

# 2. database
supabase link --project-ref <your-ref>
supabase db push          # applies supabase/migrations/*

# 3. env
cp apps/web/.env.example apps/web/.env.local
cp apps/worker/.env.example apps/worker/.env
#    fill Supabase URL/keys + DATABASE_URL (direct connection, port 5432)

# 4. run
pnpm dev:web              # http://localhost:3000
pnpm dev:worker           # separate terminal

# 5. try it
#    login → create store → paste a product URL from any JSON-LD-emitting
#    store (WooCommerce/Shopify/Salla-style) → watch the listing appear.
#    Dev storefront: http://{slug}.localhost:3000  (or /s/{slug})
```

First `pnpm dev:worker` run also needs Chromium: `pnpm --filter @loqta/worker exec playwright install chromium`.

## Import sources (adapter registry)

| Adapter | Status | Notes |
|---|---|---|
| `generic` | ✅ working | JSON-LD `Product` first, OpenGraph fallback. Covers most local Egyptian supplier sites. No per-site CSS selectors (they rot). |
| `aliexpress` | 🔑 needs credentials | Official **Dropshipping API** only — apply at open.aliexpress.com **now** (approval is slow). Scraping AliExpress is blocked + against ToS. |
| blocked sites | optional | Set `SCRAPER_API_KEY` to route generic fetches through a scraping API instead of local Playwright. Don't build your own proxy farm. |

## Pricing

Ordered step pipeline (`packages/core`), stored as jsonb per store/listing:

```json
[{"type":"fx_buffer","pct":5},
 {"type":"margin_pct","pct":30},
 {"type":"min_profit","amount":50},
 {"type":"round_to_ending","ending":99}]
```

Every new store gets a default rule via DB trigger. `computeRetail()` returns retail, effective cost, profit, and a human-readable trace for the dashboard preview.

## Sync policies (per store)

| Policy | Supplier price change | Supplier out of stock |
|---|---|---|
| `pause_only` (default) | notify | auto-pause listing + notify |
| `auto_apply` | recompute retail from rule + notify | auto-pause + notify |
| `require_approval` | notify only | auto-pause + notify |

Retail prices are **never changed silently** — that breaks running ad campaigns. Back-in-stock never auto-reactivates; the merchant decides.

Sync tiers: 1 = hourly, 2 = every 6h, 3 = daily. `sync.tick` fans out every 15 min with per-product `singletonKey` dedup and retry/backoff.

## Security notes

- RLS on every table; tenancy = `is_store_owner()`. Worker uses the direct DB role (bypasses RLS by design) and is the sole writer of the source catalog.
- `SUPABASE_SERVICE_ROLE_KEY` is server-only. Never `NEXT_PUBLIC_`. Never in git. Never in chat logs.
- `store_payment_credentials` holds merchant gateway keys — **encrypt via Supabase Vault/pgsodium before production**.
- Import URLs pass an SSRF guard in the server action; also network-isolate the worker (defense in depth).
- Scraping ethics/legals: rate-limit per domain, respect robots.txt where feasible, and the ToS must state merchants are responsible for their rights to supplier content. Watermark removal is intentionally **not** a feature.

## Roadmap

- **Phase 1 — Sell something:** product page + cart + COD checkout (admin-client server action), order management, listing editor (publish/price/images), storefront polish.
- **Phase 2 — Trust the sync:** fx refresh job, sync health dashboard, approval flow for `require_approval`, per-domain rate limits.
- **Phase 3 — Content:** Gemini rewriter UI (job exists), image pipeline to Storage (crop/logo overlay client-side; background removal on worker), auto-generated policy pages (AR/EN).
- **Phase 4 — Operate:** Paymob (merchant keys), analytics (revenue − snapshot cost − fees), fulfillment: CSV export + **WhatsApp notify to local suppliers**, AliExpress DS order creation.
- **Phase 5 — Scale the SaaS:** subscriptions/limits enforcement (tables ready), custom domains, supplier portal, team members.
