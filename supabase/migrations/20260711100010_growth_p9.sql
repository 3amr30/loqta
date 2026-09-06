-- =============================================================
-- Loqta — 10: growth P9 (shipping rates, discounts, carts, courier)
-- =============================================================

-- ---------- Per-governorate shipping ----------
-- stores.settings.shipping_fee stays as the store-wide default fallback;
-- a row here overrides it for one governorate.
create table public.shipping_rates (
  store_id      uuid not null references public.stores (id) on delete cascade,
  governorate   text not null,
  fee           numeric(12,2) not null check (fee >= 0),
  delivery_days int,
  primary key (store_id, governorate)
);

alter table public.shipping_rates enable row level security;
create policy "owner: shipping rates" on public.shipping_rates
  for all using (is_store_owner(store_id)) with check (is_store_owner(store_id));

-- ---------- Discount codes ----------
create table public.discount_codes (
  id           uuid primary key default gen_random_uuid(),
  store_id     uuid not null references public.stores (id) on delete cascade,
  code         text not null,
  type         text not null check (type in ('percent','fixed')),
  value        numeric(12,2) not null check (value > 0),
  min_subtotal numeric(12,2),
  max_uses     int,
  used_count   int not null default 0,
  expires_at   timestamptz,
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  unique (store_id, code)
);

create index idx_discounts_store on public.discount_codes (store_id, active);

alter table public.discount_codes enable row level security;
-- Owner manages codes. Validation + used_count increment at checkout run on
-- the service pool (bypass RLS) — no anon grant.
create policy "owner: discounts" on public.discount_codes
  for all using (is_store_owner(store_id)) with check (is_store_owner(store_id));

-- Persist what was applied to each order (reporting + audit).
alter table public.orders
  add column discount_code   text,
  add column discount_amount numeric(12,2) not null default 0;

-- ---------- Abandoned-cart capture ----------
-- Phone entered at checkout but not completed. Written service-side only.
create table public.cart_sessions (
  id           uuid primary key default gen_random_uuid(),
  store_id     uuid not null references public.stores (id) on delete cascade,
  phone        text not null,
  items        jsonb not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  nudged_at    timestamptz,
  completed_at timestamptz,
  unique (store_id, phone)
);

create index idx_cart_sessions_due on public.cart_sessions (store_id, updated_at)
  where completed_at is null and nudged_at is null;

alter table public.cart_sessions enable row level security;
create policy "owner: read carts" on public.cart_sessions
  for select using (is_store_owner(store_id));

-- ---------- Courier credentials (mirrors store_payment_credentials) ----------
-- TODO(security): move to Supabase Vault / pgsodium before real courier keys,
-- exactly like store_payment_credentials.
create table public.store_courier_credentials (
  store_id    uuid not null references public.stores (id) on delete cascade,
  courier     text not null check (courier in ('bosta','mylerz','jnt')),
  credentials jsonb not null,
  is_active   boolean not null default true,
  updated_at  timestamptz not null default now(),
  primary key (store_id, courier)
);

alter table public.store_courier_credentials enable row level security;
create policy "owner: courier creds" on public.store_courier_credentials
  for all using (is_store_owner(store_id)) with check (is_store_owner(store_id));
