# Loqta (لقطة) — Growth Plan (P6–P11)

> **For agentic workers:** same discipline as `docs/PLAN.md`. One phase at a time, in order. After each phase: run the verification commands, paste real output, conventional commit(s), push to `origin main`, two-line status. Never claim something works without running it. Nothing in this plan may regress a P0–P5 DoD item (PLAN.md §8).

**Goal:** extend the live MVP with eight pillars — WhatsApp integration, RTO reduction, shipping/courier, storefront conversion, growth tools, AI expansion, SaaS maturity — sequenced by dependency, riskiest change (RLS/roles) last.

---

## 0. Assumptions & verified repo facts

Facts below were verified against the working tree at `d6e971b` before planning.

1. **Duplicate import is already 90% built.** `listings` has `unique (store_id, source_product_id)` (migration 003) and `createListing` in `import-product.ts` returns the existing listing id on a repeat URL. The only gap: the merchant gets the identical "تم استيراد المنتج" notification either way. Fix = `createListing` returns an `existed` flag → different notification copy ("المنتج موجود في متجرك بالفعل") + `data.duplicate: true` → dashboard badge on the Imports row. **No new endpoint, no schema change.** (Confirms brief §0.)
2. **Multi-store is *mostly* UI, but not only UI.** The data model already allows N stores per merchant. The single-store assumption lives in **two backend spots** — `/v1/me` (`order by created_at limit 1`) and the `requireStore` decorator (same query) — plus the onboarding flow. So the real change is: `requireStore` honors an `x-store-id` header (validated against ownership/membership), `/v1/me` returns `stores[]`, dashboard gets a switcher, `POST /v1/stores` enforces `plans.max_stores`. Small and mechanical, but it **is** a backend change; planned in P11.
3. **`is_store_owner()` (migration 001) backs ~15 RLS policies in migration 005, including `for all` write policies.** A read-only `viewer` role therefore cannot be expressed by redefining the function body alone — write policies must be split from read policies. This confirms the brief's "highest blast radius, do it last, full P2 probe re-run" framing. Detail in §5/P11.
4. **RLS is defense-in-depth here, not the primary gate.** The API uses the service-role pool (bypasses RLS); the dashboard uses supabase-js for auth only. RLS protects against direct PostgREST access with a user JWT. Role enforcement therefore lands in **both** layers: `requireStore` + route guards (primary), RLS policies (safety net). Both get verified.
5. **Twilio is the single messaging vendor** (WhatsApp templates + session messages + Verify for OTP), reusing Amr's existing Twilio account/credential pattern from San3a. **Resend** for email (DRAPE/ENGX pattern). No second vendor for either channel.
6. **OTP uses Twilio Verify's WhatsApp channel**, not a hand-rolled code table. Verify stores/validates codes server-side and its OTP templates are pre-approved by Meta — this removes both the `checkout_otps` table and one template-approval dependency. After a successful check, the backend issues a short-lived HMAC token (phone+store bound, ~15 min) that the checkout request carries. *(Deviation from a literal reading of the brief; simpler and matches the San3a pattern.)*
7. **`customer_order_history` is a VIEW + an index, not a table.** Per-store trust counts are a cheap aggregate over `orders` (new index `(store_id, customer_phone)`); a maintained table adds trigger-drift risk for zero read-latency benefit at MVP scale. The view keeps the exact contract the brief describes. *(Deviation, flagged per brief §10.)*
8. **Blacklist = threshold setting on top of trust data** (brief already recommends this). No separate blacklist table. `stores.settings.block_after_cancellations` (int, default off) → checkout rejects `ORDER_BLOCKED` when the phone's per-store history crosses it.
9. **`stores.settings.shipping_fee` is kept as the store-wide default fallback**; the new `shipping_rates` table overrides per governorate. Nothing is destructively replaced, existing stores keep working with zero data migration, and the fallback is what the brief's "default for unlisted governorates" needs anyway. *(Soft deviation from "replace".)*
10. **Feature flags by presence:** every new integration env var is `.optional()` in `config.ts` (existing pattern). Missing Twilio/Resend/template vars = feature silently off + one boot warning; builds and tests never require live credentials.
11. **WhatsApp template approval is a hard external dependency** (Meta review via Twilio Content API; WABA/business verification may add days). Templates are submitted at the **start of P6**; every template-dependent feature is flag-gated so phases land regardless. Twilio's sandbox is used for live round-trip verification before approval. (Risk register #1.)
12. **Storefront budget stays a hard 150KB gzip gate.** Estimated growth: reviews/search/stock UI (P7) +6–9KB, shipping/discount checkout UI (P9) +3–4KB, AR/EN dict + switcher (P11) +2–3KB → ~112–117KB projected from today's 100.4KB. Pixel scripts (fbevents.js etc.) are third-party, loaded from injected HTML, and never enter our bundle — but they are still page weight; noted in P7 verification.
13. **Explicitly out of scope** (per brief): geographic expansion, bundle offers, merchant referral program (gated on real billing). **Additionally deferred by this plan:** AI lifestyle images (optional/experimental per brief — separate heavier API surface), cross-store trust signals (stretch, ToS-gated — schema designed, not built, §5/P8), Mylerz/J&T courier adapters (interface documented, Bosta only built), member invites for emails without an existing account (P11 v1 adds registered users only), server-side pixel CAPI (client pixel first).
14. Per-store courier credentials follow the existing `store_payment_credentials` pattern (plain jsonb + RLS + the same standing `TODO(security): Vault` note). Real production keys inherit that TODO.

### New environment variables (backend, all optional/flag-gating)

| Var | Used from | Purpose |
|---|---|---|
| `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` | P6 | REST auth + inbound signature validation |
| `TWILIO_WHATSAPP_NUMBER` | P6 | `whatsapp:+…` sender |
| `TWILIO_CONTENT_SID_ORDER_CONFIRM` / `_MERCHANT_ALERT` / `_CART_NUDGE` | P6/P8/P9 | approved template SIDs; feature off while unset |
| `TWILIO_VERIFY_SERVICE_SID` | P8 | OTP via Verify (WhatsApp channel) |
| `RESEND_API_KEY` / `NOTIFY_EMAIL_FROM` | P6 | merchant email notifications |
| `PUBLIC_API_URL` | P6 | canonical URL for Twilio signature validation behind Railway's proxy |
| `OTP_TOKEN_SECRET` | P8 | HMAC for the post-Verify checkout token |

---

## 1. Shared foundations (build once)

### 1.1 WhatsApp (`backend/src/lib/whatsapp.ts` + pure core helpers)

One module, four consumers (order confirmation P8, merchant alerts P6, abandoned cart P9, chatbot P10).

- **Transport:** plain `fetch` against Twilio's REST API (Basic auth) — no Twilio SDK dependency. `sendTemplate(to, contentSid, variables)` (business-initiated, outside 24h window) and `sendSession(to, body)` (freeform, only valid inside Meta's 24h customer-service window — callers must check `lastInboundAt`).
- **Inbound security:** `validateTwilioSignature(authToken, url, params, signature)` — HMAC-SHA1 per Twilio's spec, **pure and unit-tested**. `POST /v1/webhooks/whatsapp` rejects any request failing validation with 403 (an unverified webhook is a spoofable order-confirmation endpoint). URL reconstructed from `PUBLIC_API_URL` (proxy-safe). Twilio posts `application/x-www-form-urlencoded` → `@fastify/formbody` added.
- **Message log:** every inbound/outbound message lands in `whatsapp_messages` (store_id, direction, phone, body, template/content sid, twilio_sid, order_id?, listing_id?, created_at). This table *is* the 24h-session tracker, the webhook routing context, and the audit trail.
- **Webhook router** (priority order): ① pending order confirmation for this phone (most recent `whatsapp_confirmation_status='sent'` order) → confirm/decline path (P8). ② store-resolvable chatbot context and store has chatbot enabled → AI reply (P10). ③ otherwise log + no-op.
- **Templates submitted day one of P6** (Arabic bodies, via Twilio Content API): `loqta_order_confirm` (quick-reply نعم/لا buttons), `loqta_merchant_new_order`, `loqta_cart_nudge`. OTP needs no custom template (Verify).

### 1.2 Notification dispatch (email/WhatsApp fan-out)

`notify()` in `lib/db.ts` stays the single source of truth (in-app bell unchanged). It gains one line: enqueue `notify.dispatch {notificationId}` via the existing lazy boss handle (`lib/queue.ts` — already send-capable from the API). New worker handler loads the notification + store prefs (`settings.notify` jsonb: `{email_new_order, whatsapp_new_order, …}` — default: email on for `new_order`, everything else off) and sends via Resend / WhatsApp template. Merchant email comes from `auth.users` via the service pool. Failures retry via pg-boss and never touch the in-app row.

### 1.3 Repricing path extraction

`applyPricePolicies` in `sync.ts` contains the compute-and-write reprice block. Extracted to `repriceListing(listingId, newCost, costCurrency)` so **sync auto_apply and the P6 approval route run literally the same code** — the approval queue can never drift from the auto path.

---

## 2. API contract delta (all phases)

Same envelope/pagination/auth conventions as PLAN.md §3. 🏪 = `requireStore`.

### P6

| Route | Method | Request | Response |
|---|---|---|---|
| `/v1/price-changes` 🏪 | GET | `?status=pending\|approved\|rejected&page` | `{ data: PendingPriceChange[], meta }` |
| `/v1/price-changes/:id/approve` 🏪 | POST | — | `{ listing }` (repriced via §1.3; 409 `SUPERSEDED` if a newer change exists) |
| `/v1/price-changes/:id/reject` 🏪 | POST | — | `{ ok: true }` (price stays) |
| `/v1/webhooks/whatsapp` | POST | Twilio form-encoded; signature-validated | TwiML-empty 200 / 403 |
| `/v1/stores` 🏪 PATCH | extend | `+ whatsapp_phone? (E.164), settings.notify?` | `{ store }` |

### P7

| Route | Method | Request | Response |
|---|---|---|---|
| `/v1/public/stores/:slug/listings` | GET | `+ ?search=` (ILIKE title_ar/title_en) | unchanged shape |
| `/v1/public/stores/:slug/listings/:listingSlug` | GET | — | `+ related: PublicListing[≤4], reviews: {avg, count, latest[≤10]}` |
| `/v1/public/stores/:slug/reviews` | POST | `{ listingSlug, order_number, phone, rating 1–5, comment≤1000, name≤80 }` strictObject, rate-limited 5/min | 201 `{ pending: true }` · 422 `NOT_A_BUYER` |
| `/v1/reviews` 🏪 | GET | `?status&page` | `{ data, meta }` |
| `/v1/reviews/:id` 🏪 | PATCH | `{ status: approved\|rejected }` | `{ review }` |
| `/v1/stores` 🏪 PATCH | extend | `+ settings.{fb_pixel_id?, tiktok_pixel_id?, low_stock_threshold?, policies?{refund_ar,shipping_ar,privacy_ar, optional *_en}}` (pixel ids strict-regex) | `{ store }` |

### P8

| Route | Method | Request | Response |
|---|---|---|---|
| `/v1/public/stores/:slug/otp/send` | POST | `{ phone }` — 3/hour/phone | `{ sent: true }` |
| `/v1/public/stores/:slug/otp/check` | POST | `{ phone, code }` | `{ otpToken }` (HMAC, 15 min) |
| checkout | POST | `+ otpToken?: string` — server decides if required | `202 { otpRequired: true }` when missing-but-required · 422 `ORDER_BLOCKED` over threshold |
| `/v1/orders/:id` 🏪 | GET | — | `+ customerHistory: {total, confirmed, cancelled, returned}, whatsapp_confirmation_status` |

### P9

| Route | Method | Request | Response |
|---|---|---|---|
| `/v1/public/stores/:slug/shipping-rates` | GET | — | `{ default_fee, rates: [{governorate, fee, delivery_days}] }` |
| checkout | POST | `+ discount_code?: string≤40` (a code, never an amount) | response `+ discount_amount` |
| `/v1/shipping-rates` 🏪 | PUT | `{ default_fee?, rates: [{governorate, fee, delivery_days?}] }` (replace-all semantics) | `{ rates }` |
| `/v1/discounts` 🏪 | GET/POST | POST `{ code, type: percent\|fixed, value>0, max_uses?, min_subtotal?, expires_at?, active }` | `{ discount(s) }` |
| `/v1/discounts/:id` 🏪 | PATCH | `{ active?, expires_at?, max_uses? }` | `{ discount }` |
| `/v1/orders/:id/ship` 🏪 | POST | `{ courier: 'bosta' }` | `{ order }` with tracking_number from Bosta · 409 no credentials |
| `/v1/stores/courier-credentials` 🏪 | PUT | `{ courier: 'bosta', credentials: {api_key} }` | `{ ok }` |
| `/v1/public/stores/:slug/cart-sessions` | POST | `{ phone, items: [{listingId, variantId?, qty}] }` strict, rate-limited, upsert per (store, phone) | 204 |
| `/v1/imports` 🏪 | POST | extend: `{ url } \| { urls: string[1–50] }` (each SSRF/blocklist-checked) | 202 `{ importJobs: [...] }` |
| `/v1/trending` 🏪 | GET | — | `{ data: [{source_product, stores_count, recent_orders}] }` (platform suppliers only) |

### P10

| Route | Method | Request | Response |
|---|---|---|---|
| `/v1/listings/:id/ad-copy` 🏪 | POST | `{ platforms?: ('tiktok'\|'instagram'\|'facebook')[] }` | 202 `{ queued: true }` |
| `/v1/listings/:id/ad-copy` 🏪 | GET | — | `{ copies: [{platform, hook, body, cta, created_at}] }` |
| `/v1/stores` 🏪 PATCH | extend | `+ settings.ai_chatbot_enabled?: boolean` | `{ store }` |

### P11

| Route | Method | Request | Response |
|---|---|---|---|
| `/v1/me` | GET | — | `store` → **`stores: [{...store, role}]`** (+ `store` kept as first entry for one release, dashboard migrates same-phase) |
| all 🏪 routes | — | honor `x-store-id` header (must be a store the caller is a member of; else 403) | — |
| `/v1/stores` | POST | unchanged | 403 `PLAN_LIMIT` when at `plans.max_stores` |
| `/v1/imports` | POST | unchanged | 403 `PLAN_LIMIT` when active listings ≥ `plans.max_listings` |
| `/v1/stores/members` 🏪 | GET/POST | POST `{ email, role: staff\|viewer }` (existing registered users v1) | `{ members }` · 404 `USER_NOT_FOUND` |
| `/v1/stores/members/:userId` 🏪 | PATCH/DELETE | `{ role }` / — | owner-only |

**Role guard matrix (P11, enforced in routes + mirrored in RLS).** `viewer` = read everything, write nothing. `staff` = everything except the owner-only list. **Owner-only surfaces (exhaustive — implementation may not extend or shrink this list without a plan amendment):**

| Surface | Route guard | RLS |
|---|---|---|
| Store settings/profile | `PATCH /v1/stores` | `stores` UPDATE → owner |
| Store creation/deletion | `POST /v1/stores` (delete: no route, stays owner) | `stores` INSERT/DELETE → owner |
| Pricing rules | `PUT /v1/pricing-rules` | `pricing_rules` ALL → owner |
| Discounts writes | `POST/PATCH /v1/discounts*` | `discount_codes` writes → owner |
| Shipping rates writes | `PUT /v1/shipping-rates` | `shipping_rates` writes → owner |
| Courier credentials | `PUT /v1/stores/courier-credentials` | `store_courier_credentials` ALL → owner |
| Members management | `POST/PATCH/DELETE /v1/stores/members*` | `store_members` writes → owner |
| **Payment credentials** | *(no route yet)* | **`store_payment_credentials` stays gated to `is_store_owner()` specifically — migration 012 does NOT touch this policy. Not available to any member role at any level. Non-negotiable.** |

`staff` explicitly retains: listings CRUD, imports (single/bulk), price-change approve/reject, orders ops (status/tracking/notes/ship), reviews moderation, notifications, stats, AI rewrite/ad-copy.

---

## 3. DB delta (one migration per phase; 001–006 stay byte-for-byte)

All new tables get RLS enabled + owner policies in the same migration (pattern of 005). `create or replace view` additions only append columns (PG-safe). Apply-time note: PG17 `check_function_bodies` prefix trick from P2 applies to any `language sql` helpers.

**`…007_growth_p6.sql`**
```sql
alter table public.stores add column whatsapp_phone text;  -- merchant's number (alerts + storefront button)

create table public.pending_price_changes (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings (id) on delete cascade,
  store_id uuid not null references public.stores (id) on delete cascade,
  source_product_id uuid not null references public.source_products (id) on delete cascade,
  old_cost numeric(12,2) not null, new_cost numeric(12,2) not null, cost_currency text not null,
  old_retail numeric(12,2) not null, proposed_retail numeric(12,2),  -- preview at creation; approval recomputes
  status text not null default 'pending' check (status in ('pending','approved','rejected','superseded')),
  created_at timestamptz not null default now(), decided_at timestamptz
);
create index idx_ppc_store on public.pending_price_changes (store_id, status, created_at desc);
-- + RLS: owner select/update via is_store_owner(store_id)

create table public.whatsapp_messages (
  id uuid primary key default gen_random_uuid(),
  store_id uuid references public.stores (id) on delete cascade,
  direction text not null check (direction in ('in','out')),
  phone text not null, body text, content_sid text, twilio_sid text,
  order_id uuid references public.orders (id) on delete set null,
  listing_id uuid references public.listings (id) on delete set null,
  created_at timestamptz not null default now()
);
create index idx_wa_phone on public.whatsapp_messages (phone, created_at desc);
-- + RLS: owner select via is_store_owner(store_id)

create or replace view public.storefront_listings as
  select l.id, l.store_id, l.slug, l.title_ar, l.title_en, l.description_ar, l.description_en,
         l.images, l.retail_price, l.currency, l.created_at, sp.stock_status,
         sp.stock_qty                                   -- NEW (non-sensitive, §1/§5 low-stock)
  from public.listings l join public.source_products sp on sp.id = l.source_product_id
  where l.status = 'active';

alter type public.notification_type add value if not exists 'price_approval';
```

**`…008_growth_p7.sql`**
```sql
create table public.product_reviews (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores (id) on delete cascade,
  listing_id uuid not null references public.listings (id) on delete cascade,
  order_id uuid references public.orders (id) on delete set null,   -- the verified purchase
  rating smallint not null check (rating between 1 and 5),
  comment text, buyer_name text not null,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  created_at timestamptz not null default now(),
  unique (order_id, listing_id)                        -- one review per purchased line
);
create index idx_reviews_listing on public.product_reviews (listing_id, status);
-- + RLS owner select/update; public reads go through the API (service pool, approved-only) — no anon grant

alter type public.notification_type add value if not exists 'review_pending';

create or replace view public.storefront_stores as    -- append low_stock_threshold + whatsapp_phone
  select id, name, slug, logo_url, currency, settings -> 'theme' as theme,
         coalesce((settings ->> 'shipping_fee')::numeric, 0) as shipping_fee,
         coalesce((settings ->> 'low_stock_threshold')::int, 5) as low_stock_threshold,
         whatsapp_phone
  from public.stores;
```

**`…009_growth_p8.sql`**
```sql
alter table public.orders
  add column whatsapp_confirmation_status text
    check (whatsapp_confirmation_status in ('sent','confirmed','declined','no_response')),
  add column whatsapp_confirmed_at timestamptz;
-- Checkout hot path: needsOtp / block-threshold / trust lookups are all
-- WHERE store_id = $1 AND customer_phone = $2 — this composite serves that
-- exact query (and the view's group by); it is not a general-purpose index.
create index idx_orders_phone on public.orders (store_id, customer_phone);

create view public.customer_order_history as          -- trust score = live aggregate, no drift
  select store_id, customer_phone,
         count(*)::int as total,
         count(*) filter (where status in ('confirmed','fulfilled','shipped','delivered'))::int as confirmed,
         count(*) filter (where status = 'cancelled')::int as cancelled,
         count(*) filter (where status = 'returned')::int as returned
  from public.orders group by store_id, customer_phone;
-- owner-scoped via API (service pool); no anon grant

alter type public.notification_type add value if not exists 'order_flagged';
```
*(Cross-store stretch — documented, NOT created: `platform_phone_signals(phone_hash sha256(phone||server salt), tier smallint, updated_at)` populated only from stores with an explicit opt-in flag, exposing a coarse tier, gated on a ToS update disclosing sharing.)*

**`…010_growth_p9.sql`**
```sql
create table public.shipping_rates (
  store_id uuid not null references public.stores (id) on delete cascade,
  governorate text not null, fee numeric(12,2) not null check (fee >= 0),
  delivery_days int, primary key (store_id, governorate)
);
create table public.discount_codes (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores (id) on delete cascade,
  code text not null, type text not null check (type in ('percent','fixed')),
  value numeric(12,2) not null check (value > 0),
  min_subtotal numeric(12,2), max_uses int, used_count int not null default 0,
  expires_at timestamptz, active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (store_id, code)
);
alter table public.orders add column discount_code text, add column discount_amount numeric(12,2) not null default 0;
create table public.cart_sessions (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores (id) on delete cascade,
  phone text not null, items jsonb not null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  nudged_at timestamptz, completed_at timestamptz,
  unique (store_id, phone)
);
create table public.store_courier_credentials (      -- mirrors store_payment_credentials (+ same Vault TODO)
  store_id uuid not null references public.stores (id) on delete cascade,
  courier text not null check (courier in ('bosta','mylerz','jnt')),
  credentials jsonb not null, is_active boolean not null default true,
  updated_at timestamptz not null default now(), primary key (store_id, courier)
);
-- + RLS: owner policies on all four (cart_sessions: owner select only; writes are service-side)
```

**`…011_growth_p10.sql`**
```sql
create table public.ad_copies (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings (id) on delete cascade,
  store_id uuid not null references public.stores (id) on delete cascade,
  platform text not null check (platform in ('tiktok','instagram','facebook')),
  hook text not null, body text not null, cta text not null,
  created_at timestamptz not null default now()
);
alter type public.notification_type add value if not exists 'chat_handoff';
-- + RLS: owner select/delete
```

**`…012_growth_p11_roles.sql`** *(its own migration, its own phase-half — see P11)*
```sql
create table public.store_members (
  store_id uuid not null references public.stores (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role text not null check (role in ('owner','staff','viewer')),
  invited_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  primary key (store_id, user_id)
);
insert into public.store_members (store_id, user_id, role)  -- backfill: creators are owners
  select id, merchant_id, 'owner' from public.stores on conflict do nothing;

create or replace function public.is_store_member(sid uuid, roles text[])
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from store_members where store_id = sid and user_id = auth.uid() and role = any(roles))
      or exists (select 1 from stores where id = sid and merchant_id = auth.uid());  -- creator is always owner
$$;
-- is_store_owner() KEPT with unchanged owner-only semantics for owner-only surfaces.
-- Then: DROP + recreate every 005/007–011 policy, split per operation:
--   select  → is_store_member(store_id, array['owner','staff','viewer'])
--   write   → is_store_member(store_id, array['owner','staff'])
--   stores UPDATE / payment & courier credentials / pricing_rules / store_members writes → owner only
-- store_members RLS: members read their store's roster; owner writes.
```

---

## 4. Phase breakdown

Every phase ends with: `pnpm -r typecheck && pnpm -r test && pnpm lint && pnpm -r build` + bundle budget (output pasted), live verification listed below, conventional commits, push, two-line status.

---

### P6 — Existing-system fixes + WhatsApp foundation

**Day-one external task (lead time):** submit the three WhatsApp templates via Twilio Content API + start WABA verification; paste submission IDs into the phase report. Sandbox joined for dev round-trips.

**Tasks**
1. **Image pipeline finish (first — lowest risk/highest value):** `lib/supabase.ts` service Storage client; `process-image.ts` uploads webp to `product-images/{source_product_id}/{md5(imageUrl).slice(0,12)}.webp` (skip-if-exists → 50 merchants share one upload), swaps the URL inside `listings.images` of the requesting listing. **Wire the enqueue** (nothing enqueues `image.process` today): `import-product.ts` after `createListing` (new listings only), first 6 images, `singletonKey` per listing+hash. Verification includes a real import whose listing images point at `supabase.co/storage`.
2. Migration 007 applied (+ RLS probes for the two new tables).
3. **require_approval queue:** `decideSyncActions` gains `queueApproval` (require_approval + price change → row in `pending_price_changes` with `proposed_retail` preview + `price_approval` notification; older pending row for the same listing → `superseded`). §1.3 `repriceListing()` extracted; approve route uses it; reject dismisses. Dashboard: "موافقات الأسعار" queue (Approve/Reject, old→new cost + proposed retail).
4. **Tier promotion:** in `handleSyncTick`, before selection: promote to tier 1 any `source_product` with order activity (non-cancelled/returned `order_items`) in 14 days; demote tier-1 rows with none back to tier 2. Two UPDATEs, unit-tested date logic in SQL verified live.
5. **Duplicate-import message** per §0.1 (worker copy + `data.duplicate` + dashboard badge).
6. **WhatsApp lib** per §1.1 (fetch transport, signature validation pure + tested, `whatsapp_messages` log, webhook route with router skeleton: confirmation branch stubs to P8, chatbot branch stubs to P10, else no-op) + `@fastify/formbody`.
7. **Notification dispatch** per §1.2 (Resend email for `new_order` default-on; WhatsApp merchant alert via `loqta_merchant_new_order` when template approved + `stores.whatsapp_phone` set). Settings page: notification prefs + WhatsApp number field.
8. `PATCH /v1/stores` extended (`whatsapp_phone` E.164 Zod, `settings.notify`).

**Tests:** signature validation (4+: valid/tampered/missing/url-mismatch), dispatch pref matrix (4), decideSyncActions require_approval cases extended (3), tier promotion SQL builder (2), storage path fn (2).
**Verify (live):** import → images on Storage URLs; `update source_products set price=…` under require_approval → pending row + notification → Approve → retail equals auto_apply's result for the same input (paste both) → Reject keeps price; sandbox WhatsApp round-trip logged in `whatsapp_messages`; real Resend email for a real order; RLS probes (anon sees neither new table; owner sees own).
**Commits:** `feat: image storage upload + sync tier promotion` · `feat: price-change approval queue` · `feat: whatsapp foundation + notification dispatch (email/whatsapp)`.

---

### P7 — Storefront conversion + pixels

**Tasks**
1. Migration 008 (+ probes).
2. **Reviews:** public submit (verified purchase: order_number+phone must match a non-cancelled order of this store containing the listing → 422 `NOT_A_BUYER` otherwise; rate-limited; `pending` default + `review_pending` notification). Merchant moderation page. Product page shows approved reviews + average; listing detail API returns aggregate; **`inject.ts` adds `aggregateRating` to the JSON-LD** when approved reviews exist (same escaping rules, extends the tested injector).
3. **WhatsApp button** on product page: `wa.me/{store.whatsapp_phone}?text=<prefilled Arabic incl. product title + URL>` (the prefilled URL is what P10's chatbot parses for context). Hidden when no number.
4. **Policy pages (AR/EN per brief §5):** default AR templates as constants (rendered when `settings.policies` unset), merchant-editable via Settings; optional `*_en` fields stored now and surfaced by the P11 EN toggle (AR fallback until then); storefront routes `/pages/refund|shipping|privacy`; served through the same static-tenants/injection path (store-level meta).
5. **Related products:** listing-detail API appends 4 same-store active listings (excl. current, newest first) — plain SQL; storefront section.
6. **Search:** `?search=` ILIKE on the public listings endpoint (index-free; pg_trgm noted as the upgrade path if catalogs grow) + storefront search box (debounced).
7. **Stock indicators:** product page shows "باقي X" when `0 < stock_qty ≤ low_stock_threshold`, and nothing otherwise — numbers only ever from `source_products.stock_qty` via the view. No fabricated urgency.
8. **Pixels:** `settings.fb_pixel_id` (`/^\d{5,20}$/`) / `settings.tiktok_pixel_id` (`/^[A-Z0-9]{10,30}$/`) — regex-validated at PATCH **and** re-checked at injection (defense in depth; nothing non-matching is ever interpolated). `injectPixels(html, ids)` in `seo/` (same `</head>` block pattern, unit-tested). Storefront `lib/track.ts`: guarded `fbq`/`ttq` wrappers firing PageView (base snippet), ViewContent, AddToCart, InitiateCheckout, and **Purchase on the Success page only** (order already created server-side; value/orderNumber from checkout response via router state).

**Tests:** verified-purchase gate (4), review schema/rate shape (2), injectPixels (4: both/one/none/invalid-id-dropped), aggregateRating injection (2), related/search SQL shapes via inject (2).
**Verify (live):** review submit with a real LQ order → pending → approve → visible on storefront + `aggregateRating` in page source; fake order_number → 422; `curl -H "Host: …"` shows pixel base code with the configured id and **not** with an invalid one; search returns the coffee listing by substring; stock badge appears when `stock_qty` set ≤ threshold; bundle budget output pasted.
**Commits:** `feat: reviews + policy pages + related + search + stock indicators` · `feat: fb/tiktok pixel injection + storefront events`.

---

### P8 — RTO reduction (confirmation, trust, conditional OTP)

**Tasks**
1. Migration 009 (+ probes; `customer_order_history` returns correct counts for the livetest phone).
2. **Order confirmation:** `executeCheckout` (store toggle + template approved) → enqueue `whatsapp.confirm` → worker sends `loqta_order_confirm` template, sets `whatsapp_confirmation_status='sent'`, logs message. Webhook confirmation branch (P6 skeleton) goes live: normalize reply (نعم/اه/yes/تأكيد → confirm; لا/no/الغاء → decline); confirm → existing transition guard `pending→confirmed` + `whatsapp_confirmed_at` + notify; decline → status `declined` + `order_flagged` notification — **order stays `pending` for manual review, never auto-cancelled**.
3. **Timeout:** `confirm.timeout` cron (hourly): `sent` orders older than `settings.confirmation_timeout_hours` (default 6) → `no_response` + `order_flagged`. Dashboard Orders: confirmation badge column + "محتاج مراجعة" filter tab.
4. **Trust signal:** order detail shows the phone's per-store history ("الرقم ده عنده ٢ طلب ملغي معاك") from the view.
5. **Conditional OTP:** trust decision pure fn `needsOtp(history)` = no prior confirmed order OR any cancellation, at this store. Flow per §2/P8 routes (Twilio Verify WhatsApp channel; HMAC `otpToken` binds phone+store, 15 min, `OTP_TOKEN_SECRET`). Checkout: token verified server-side when required; storefront adds the OTP step conditionally (202 → code input → retry). Store toggle `settings.otp_enabled` **default off** — friction is the merchant's call.
6. **Block threshold:** `settings.block_after_cancellations` (default unset=off) → checkout 422 `ORDER_BLOCKED` (polite Arabic copy) when history crosses it. This *is* the blacklist.
7. Cross-store trust: **not built** — §3/009 comment documents the future `platform_phone_signals` design + ToS gate, per brief.

**Tests:** reply normalization (6), needsOtp matrix (5), otpToken sign/verify/expiry/cross-store rejection (4), timeout SQL builder (2), computeOrder untouched-paths regression re-run.
**Verify (live):** real COD order on sandbox → template arrives on a real phone → reply نعم → order `confirmed` in dashboard with `whatsapp_confirmed_at` (paste SQL) → reply لا on a second order → `declined` + flagged notification, still `pending`; timeout probe with a 1-minute setting; OTP: first-time phone gets 202 → Verify code on WhatsApp → token → 201; repeat buyer skips OTP; blocked phone gets `ORDER_BLOCKED`.
**Commits:** `feat: whatsapp order confirmation round-trip` · `feat: per-store trust score + conditional otp + block threshold`.

---

### P9 — Shipping & delivery + growth money math

**Tasks**
1. Migration 010 (+ probes on all four tables).
2. **computeOrder v2** — the money-math change, done once for both features: signature gains `resolvedShippingFee` (from `shipping_rates[governorate] ?? settings.shipping_fee`, resolved in `executeCheckout` SQL — server-side, tamper-proof like every other price component) and optional `discount` row → validates active/expiry/min_subtotal, `discount_amount = min(round2(percent·subtotal) | fixed, subtotal)`, `total = subtotal − discount + shipping`. `used_count` incremented inside the checkout transaction with `update … where used_count < max_uses returning id` (race-safe; miss → `DISCOUNT_INVALID`). Existing test suite extended, all P3 tamper tests re-run.
3. Public shipping-rates endpoint; storefront checkout: fee + delivery estimate ("التوصيل خلال ٣–٥ أيام" when `delivery_days` set) update on governorate select; discount code field with server-validated feedback.
4. Dashboard: Shipping page (27-governorate fee/days editor + default), Discounts CRUD page.
5. **CourierAdapter** (`backend/src/courier/types.ts`, mirroring `SourceAdapter`): `{ id, createShipment(order, creds) → {trackingNumber, labelUrl?}, getTracking(trackingNumber, creds) → CourierStatus }`. **Bosta implementation only**; Mylerz/J&T documented as future adapters in the interface file. `PUT courier-credentials` (jsonb + Vault TODO). `POST /v1/orders/:id/ship` → creates the Bosta delivery, saves `tracking_number` (replacing manual typing; manual field stays as fallback). `courier.track` cron (2h): polls non-terminal shipped orders, advances `shipped→delivered` **through the existing transition guard only**.
6. **Abandoned carts (flagged as the checkout-flow change it is):** storefront checkout captures `(phone, items)` to `cart-sessions` once the phone field validates (fire-and-forget, strict schema, rate-limited); successful checkout marks `completed_at`. `cart.nudge` cron (hourly): idle > `settings.cart_nudge_hours` (default 6), not nudged, not completed → **one** `loqta_cart_nudge` template, ever. Store toggle default **off**; privacy-policy default template updated to disclose it.
7. **Bulk import:** `POST /v1/imports` accepts `urls[1–50]`, each through the same SSRF/blocklist gate; dashboard textarea (URL per line).
8. **Trending:** merchant endpoint + dashboard page — platform-supplier `source_products` ranked by store adoption + 30-day order volume, one-click re-import CTA (existing import flow).

**Tests:** computeOrder v2 (~12: governorate fee/fallback, percent/fixed/floor/expiry/min_subtotal/max_uses, combined discount+shipping), Bosta payload builder + response parse (4, fixture-based), cart nudge selection SQL (2), bulk zod (2).
**Verify (live):** checkout from two governorates hits two different fees (SQL paste); tampered `discount_amount` in body → schema reject; real discount code round-trip incl. exhausted `max_uses` → 422; Bosta **staging** shipment created with real tracking number saved (or documented mock if staging creds unavailable — flagged honestly); abandoned cart on sandbox → nudge exactly once; bulk import of 3 URLs → 3 jobs; budget output.
**Commits:** `feat: per-governorate shipping + discount codes (computeOrder v2)` · `feat: bosta courier adapter + tracking sync` · `feat: abandoned-cart recovery + bulk import + trending`.

---

### P10 — AI expansion

Both reuse the P5 Gemini pattern exactly: Zod-validated output, drift → non-fatal fallback, never blind-trusted.

**Tasks**
1. Migration 011.
2. **WhatsApp AI chatbot** (webhook branch ② goes live): context = listing parsed from the wa.me prefill URL in the thread (or last outbound `listing_id` in `whatsapp_messages`), exact title/description/price/stock from the DB, store policies, recent thread (≤10 msgs). Gemini → `ChatReplySchema = z.object({ reply: string≤600, handoff: boolean })`; `handoff` (or any parse failure) → polite "هحولك لصاحب المتجر" + `chat_handoff` notification with the thread. **System prompt forbids invented prices/policies/promises — it may only restate provided data.** Caps: 10 replies/phone/day, session messages only (24h window from `whatsapp_messages`), everything logged. Store toggle default off.
3. **Ad-copy generator:** `content.adcopy` job (same worker file pattern), `AdCopySchema = z.array(z.object({platform, hook, body, cta})).min(1).max(3)` → `ad_copies` rows + `content_ready` notification (`data.kind='adcopy'`). ListingEdit gains an "إعلانات ✨" tab: generate button + history + copy-to-clipboard.
4. AI lifestyle images: **not built** (optional/experimental per brief) — one paragraph in README backlog.

**Tests:** ChatReplySchema + handoff-on-drift (3), context builder listing-URL parsing (3), caps counter (2), AdCopySchema (2).
**Verify (live):** sandbox chat: price question → correct EGP answer from DB (paste thread); off-context question ("هتوصل امتى لأسوان؟" with no policy set) → handoff + merchant notification; 11th message → capped. Real ad copy for the coffee listing pasted; drift injection (mocked) keeps table empty + logs.
**Commits:** `feat: whatsapp ai chatbot with human handoff` · `feat: ai ad-copy generator`.

---

### P11 — SaaS maturity (roles LAST, isolated)

**P11a — everything except roles** (no schema change):
1. **Plan enforcement:** counts checked in `POST /v1/stores` (max_stores) and `POST /v1/imports` (active+draft listings vs max_listings) → 403 `PLAN_LIMIT` + Arabic upsell copy in dashboard. Free-plan limits now real.
2. **White-label:** `plans.features->>'remove_branding'` → `storeBySlug` query joins subscription→plan and returns `branding: boolean`; storefront footer "مدعوم من لقطة ⚡" rendered conditionally.
3. **Multi-store UX:** `requireStore` honors `x-store-id` (validated: caller must own it pre-roles / be a member post-roles; else 403), keeps first-store fallback; `/v1/me` returns `stores[]`; dashboard StoreSwitcher in Layout (persisted in localStorage, sent by `api.ts`); Onboarding allows "متجر جديد" under the plan limit.
4. **AR/EN toggle:** hand-rolled ~1KB dict hook (`t('checkout.title')`), `<html lang/dir>` swap, listing pages prefer `*_en` fields in EN mode with AR fallback. **No i18n library** — budget guard re-run.

**P11b — multi-user roles (own migration, own commits, full regression):**
5. Migration 012 per §3: `store_members` + backfill + `is_store_member(sid, roles[])` + **every policy dropped/recreated** with the §2 role matrix. `is_store_owner` kept, semantics unchanged, for owner-only surfaces.
6. Backend: `requireStore` resolves membership + attaches `req.role`; owner-only route guards per the matrix; members CRUD (existing registered users by email via service-role auth admin lookup; invite-by-email for non-users = documented follow-up).
7. Dashboard: Members page (list/add/remove/role), role-aware UI hiding owner-only sections.
8. **Full P2 RLS probe suite re-run + new probes**, all output pasted: anon base-table denials (unchanged), owner CRUD (unchanged), **staff** can update a listing but not pricing_rules/settings/credentials, **viewer** selects everything but every write fails, **non-member** sees nothing, storefront views unaffected, `cost_snapshot` still unreachable by anon.

**Tests:** plan-limit fn (3), store-switch guard (3), role matrix unit coverage via inject with three role tokens (6+), members schemas (2).
**Verify (live):** second store created on a pro-plan test merchant + switcher round-trip; free merchant blocked at limit with `PLAN_LIMIT` (paste); branding flag flips the footer (curl both states); EN toggle renders the coffee listing's `title_en`; then the full RLS probe transcript (§8 gate).
**Commits:** `feat: plan enforcement + white-label + store switcher + ar/en toggle` · `feat: multi-user store roles (rls rework)` · `test: full rls regression transcript`.

---

## 5. Quality gates (unchanged + additions)

Everything from PLAN.md §6 stands. Additions for this plan:
- Every phase touching RLS (P6, P7, P8, P9, P10 tables; P11b wholesale) ships live probes with pasted output — new tables get at minimum: anon denied, owner allowed, other-merchant denied.
- New pure logic gets unit tests the way `computeRetail`/`computeOrder` did: Twilio signature validation, reply normalization, `needsOtp`, otpToken HMAC, discount/shipping math, Bosta payload parsing, pixel-id validation, ChatReply/AdCopy schemas, plan-limit checks.
- **checkout regression rule:** any phase touching `computeOrder` or the checkout route (P8, P9) re-runs the P3 tamper probes live (price fields rejected, rate limit) and pastes them.
- Bundle budget gate unchanged (150KB); output pasted in every phase that touches the storefront (P7, P8, P9, P11).
- Feature-flag rule: absent env/template SIDs must never fail builds, tests, or boot — only disable the feature with one warn log.

## 6. Risk register

| # | Risk | Impact | Mitigation |
|---|---|---|---|
| 1 | **WhatsApp template approval + WABA verification lead time** (Meta review; days–weeks) — blocks confirmation/nudges/merchant alerts | RTO features idle | Submit all 3 templates + start WABA on **P6 day one** (like AliExpress DS-API in P0); sandbox for all dev/live round-trips; every consumer flag-gated on template SID presence; OTP unaffected (Verify pre-approved) |
| 2 | **Roles/RLS rework breaks tenancy** — 15+ policies recreated | Cross-tenant data exposure | Isolated migration + phase-half; policies split read/write per matrix; full P2 probe suite + staff/viewer/non-member probes re-run with pasted output before done |
| 3 | **Money-math regression** (discounts + per-governorate fees rewrite checkout totals) | Wrong charges, broken trust | `computeOrder` stays pure with the suite extended first (TDD order); discount amount computed server-side only, code-not-amount over the wire; `max_uses` race handled in-transaction; P3 tamper probes re-run |
| 4 | **Buyer-phone privacy** (trust aggregates, cart capture pre-order) | Legal/trust damage | Per-store data only (merchant already owns it); cross-store version explicitly NOT built (ToS-gated design doc only); privacy-policy template discloses cart capture + nudges; nudge = one message, store toggle default off; Sentry scrubber already masks phones |
| 5 | **Webhook spoofing** — unverified inbound WhatsApp = attacker-confirmable orders | Fake confirmations | Twilio signature validation (pure, tested) rejects before any routing; `PUBLIC_API_URL` pins the signed URL behind Railway's proxy; webhook writes only through the existing transition guard |
| 6 | **Pixel injection = third-party script in templated HTML** | XSS on storefronts | IDs strict-regex at write AND at render; only literal IDs interpolated into constant snippets; extends the `</script`-safe tested injector; never arbitrary merchant HTML |
| 7 | **Chatbot hallucination** (invented prices/policies) | Merchant liability | Structured Zod output with `handoff` default-on-drift; prompt restricted to provided DB facts; caps/day; full logging; store toggle default off |
| 8 | **Bosta API access/behavior** (per-merchant creds, staging availability) | Fulfillment feature slips | Adapter interface isolates it (SourceAdapter precedent); manual tracking field remains as fallback; verification honestly downgrades to documented mock if staging creds unavailable |
| 9 | **Resend domain/deliverability** (DNS verification on loqta.shop) | Silent email loss | User-side DNS task listed in P6 report; dispatch failures visible via pg-boss retries + Sentry; bell remains source of truth |
| 10 | **Storefront budget creep** (reviews/search/OTP/i18n UI) | Slow 3G product pages | Hard CI gate unchanged; projected ceiling ~117KB/150; no new UI/i18n libraries permitted by plan |

Watchlist: `store_courier_credentials`/`store_payment_credentials` still plain jsonb (standing Vault TODO, now with two tables) · notification enum growth (fine — additive) · `whatsapp_messages` volume (index on phone+date; retention policy post-MVP) · ILIKE search at large catalogs (pg_trgm upgrade path noted) · Purchase pixel fires client-side on Success (CAPI server-side is the documented upgrade) · `pending_price_changes` is a new table rather than a `sync_events` status column because approvals are per **listing+store** while `sync_events` rows are per source_product (platform-wide) · tier promotion can outpace `plans.sync_interval_hours` (never enforced in MVP) — cap promotion by plan tier when P11 enforcement lands.

## 7. Definition of done (mirror of brief §11)

A merchant can: see and act on a `require_approval` price change from a real queue (approve = identical result to auto_apply); watch a real order complete a WhatsApp confirmation round-trip (نعم → confirmed via the transition guard); see a repeat customer's trust signal on the order page; a buyer checks out with a governorate-specific fee and a discount code, both recomputed server-side with tamper probes passing; browse a storefront with approved verified-purchase reviews, working search, and stock indicators traceable to `source_products.stock_qty`; create a Bosta shipment whose tracking number lands without typing; and receive WhatsApp/email nudges for a new order and an abandoned cart. Supplier images serve from Supabase Storage. The roles change ships only with the full P2 RLS probe suite re-run and passing (pasted). CI green, `main` pushed, and this file records every deviation the way PLAN.md did for P0–P5.

---

## 8. Self-review notes (deviations already argued above)

Consolidated list the reviewer should approve/reject explicitly:
1. `customer_order_history` as **view+index**, not a maintained table (§0.7).
2. OTP via **Twilio Verify** — no code table, no OTP template approval (§0.6).
3. `settings.shipping_fee` **kept as fallback** under `shipping_rates` (§0.9).
4. `is_store_owner()` **kept** (owner-only semantics); policies rewritten to the new `is_store_member(sid, roles[])` with a read/write split — this is the brief's "rework", made precise (§3/012).
5. Duplicate-import fix includes a **two-line worker copy change** (notification text + flag), not UI-only — the dashboard can't know it was a duplicate otherwise (§0.1).
6. Multi-store needs the **`x-store-id` backend change** in `requireStore`/`me`, not just a UI switcher (§0.2).
7. Ad copy persisted to an `ad_copies` table (history + clipboard UX) instead of notification-only.
8. P9 is the heaviest phase but deliberately batches **both** `computeOrder` changes (shipping + discounts) into one money-math rewrite with one regression pass.
9. Cart-session capture endpoint is public and rate-limited; it stores `(phone, items)` pre-order — called out as the checkout-flow change the brief warned about, with disclosure + default-off nudges.
