-- =============================================================
-- Loqta — 02: identity, SaaS plans, stores, suppliers, FX
-- =============================================================

-- ---------- Profiles (1:1 with auth.users) ----------
create table public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  full_name  text not null default '',
  phone      text,
  role       text not null default 'merchant' check (role in ('merchant', 'admin')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_profiles_updated before update on public.profiles
  for each row execute function public.set_updated_at();

create trigger trg_handle_new_user
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- SaaS plans (commercial product => billing is first-class) ----------
create table public.plans (
  id            text primary key,          -- 'free' | 'growth' | 'pro'
  name_ar       text not null,
  name_en       text not null,
  price_egp     numeric(10,2) not null default 0,
  max_stores    int not null default 1,
  max_listings  int not null default 20,
  sync_interval_hours int not null default 24, -- fastest allowed sync tier
  features      jsonb not null default '{}'::jsonb,
  is_active     boolean not null default true
);

insert into public.plans (id, name_ar, name_en, price_egp, max_stores, max_listings, sync_interval_hours) values
  ('free',   'مجاني', 'Free',   0,    1, 20,  24),
  ('growth', 'نمو',   'Growth', 299,  1, 200, 6),
  ('pro',    'برو',   'Pro',    699,  3, 1000, 1)
on conflict (id) do nothing;

create table public.subscriptions (
  id            uuid primary key default gen_random_uuid(),
  merchant_id   uuid not null references public.profiles (id) on delete cascade,
  plan_id       text not null references public.plans (id),
  status        text not null default 'active' check (status in ('active', 'past_due', 'cancelled')),
  current_period_end timestamptz,
  created_at    timestamptz not null default now(),
  unique (merchant_id)
);

-- ---------- Stores (the tenant) ----------
create table public.stores (
  id            uuid primary key default gen_random_uuid(),
  merchant_id   uuid not null references public.profiles (id) on delete cascade,
  name          text not null,
  slug          text not null unique
                check (slug ~ '^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$'),
  custom_domain text unique,
  currency      text not null default 'EGP',
  logo_url      text,
  -- Theme / public prefs ONLY. Secrets go in store_payment_credentials.
  settings      jsonb not null default '{}'::jsonb,
  sync_policy   public.sync_policy not null default 'pause_only',
  order_counter int not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index idx_stores_merchant on public.stores (merchant_id);

create trigger trg_stores_updated before update on public.stores
  for each row execute function public.set_updated_at();

-- Merchant-owned gateway keys ("bring your own Paymob/Stripe").
-- MVP: plain jsonb + RLS. TODO(security): move to Supabase Vault / pgsodium
-- column encryption before real merchant keys land here.
create table public.store_payment_credentials (
  store_id    uuid not null references public.stores (id) on delete cascade,
  provider    public.payment_method not null,
  credentials jsonb not null,
  is_active   boolean not null default true,
  updated_at  timestamptz not null default now(),
  primary key (store_id, provider)
);

-- ---------- Suppliers ----------
-- 'platform' suppliers are curated by Loqta and visible to all merchants
-- (this is the Taager-style local-supplier network + shared AliExpress sources).
-- 'private' suppliers belong to one store.
create table public.suppliers (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  type           public.supplier_type not null,
  visibility     public.supplier_visibility not null default 'platform',
  owner_store_id uuid references public.stores (id) on delete cascade,
  website_url    text,
  whatsapp_phone text,          -- fulfillment notifications for local suppliers
  country        text not null default 'EG',
  ships_from     text,
  avg_lead_days  int,
  is_active      boolean not null default true,
  created_at     timestamptz not null default now(),
  constraint private_needs_owner
    check (visibility = 'platform' or owner_store_id is not null)
);

create index idx_suppliers_type on public.suppliers (type) where is_active;

-- ---------- FX rates (EGP volatility => snapshot everything) ----------
create table public.fx_rates (
  base       text not null,
  quote      text not null,
  rate       numeric(14,6) not null,
  fetched_at timestamptz not null default now(),
  primary key (base, quote)
);

-- Placeholder seed — the worker's fx job must refresh this before go-live.
insert into public.fx_rates (base, quote, rate) values ('USD', 'EGP', 50.000000)
on conflict (base, quote) do nothing;
