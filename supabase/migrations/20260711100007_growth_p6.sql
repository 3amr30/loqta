-- =============================================================
-- Loqta — 07: growth P6 (approval queue, whatsapp, stock qty)
-- =============================================================

-- Merchant's own WhatsApp number: merchant order alerts (P6 dispatch)
-- and the storefront contact button (P7).
alter table public.stores add column whatsapp_phone text;

-- ---------- require_approval queue ----------
-- One row per proposed supplier price change per listing. Approvals are
-- per listing+store; sync_events are per source_product (platform-wide),
-- which is why this is its own table and not a sync_events status column.
create table public.pending_price_changes (
  id                uuid primary key default gen_random_uuid(),
  listing_id        uuid not null references public.listings (id) on delete cascade,
  store_id          uuid not null references public.stores (id) on delete cascade,
  source_product_id uuid not null references public.source_products (id) on delete cascade,
  old_cost          numeric(12,2) not null,
  new_cost          numeric(12,2) not null,
  cost_currency     text not null,
  old_retail        numeric(12,2) not null,
  proposed_retail   numeric(12,2),           -- preview at creation; approval recomputes
  status            text not null default 'pending'
                    check (status in ('pending','approved','rejected','superseded')),
  created_at        timestamptz not null default now(),
  decided_at        timestamptz
);

create index idx_ppc_store on public.pending_price_changes (store_id, status, created_at desc);
create index idx_ppc_listing_pending on public.pending_price_changes (listing_id)
  where status = 'pending';

alter table public.pending_price_changes enable row level security;
create policy "owner: read price changes" on public.pending_price_changes
  for select using (is_store_owner(store_id));
-- Decisions (approve/reject) go through the API with the service role;
-- no direct client writes on purpose.

-- ---------- WhatsApp message log ----------
-- Audit trail + Meta 24h-session tracker + inbound-webhook routing context.
create table public.whatsapp_messages (
  id          uuid primary key default gen_random_uuid(),
  store_id    uuid references public.stores (id) on delete cascade,
  direction   text not null check (direction in ('in','out')),
  phone       text not null,                 -- E.164, e.g. +201012345678
  body        text,
  content_sid text,                          -- template Content SID when templated
  twilio_sid  text,
  order_id    uuid references public.orders (id) on delete set null,
  listing_id  uuid references public.listings (id) on delete set null,
  created_at  timestamptz not null default now()
);

create index idx_wa_phone on public.whatsapp_messages (phone, created_at desc);
create index idx_wa_store on public.whatsapp_messages (store_id, created_at desc);

alter table public.whatsapp_messages enable row level security;
create policy "owner: read whatsapp log" on public.whatsapp_messages
  for select using (is_store_owner(store_id));

-- ---------- stock_qty for the storefront low-stock indicator ----------
-- Appends ONE non-sensitive column at the end (safe for create-or-replace).
-- cost columns still never cross this line.
create or replace view public.storefront_listings as
  select l.id, l.store_id, l.slug, l.title_ar, l.title_en,
         l.description_ar, l.description_en, l.images,
         l.retail_price, l.currency, l.created_at,
         sp.stock_status,
         sp.stock_qty
  from public.listings l
  join public.source_products sp on sp.id = l.source_product_id
  where l.status = 'active';

-- ---------- notification type ----------
alter type public.notification_type add value if not exists 'price_approval';
