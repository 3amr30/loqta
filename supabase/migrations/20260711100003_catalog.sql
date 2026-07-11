-- =============================================================
-- Loqta — 03: catalog
--
-- KEY DESIGN: source_products are CANONICAL & SHARED.
-- If 50 merchants import the same supplier URL, we store it once
-- and sync it once. Each merchant gets their own `listing` that
-- references it with their own prices, content and overrides.
-- =============================================================

-- ---------- Source products (supplier side, written by the worker) ----------
create table public.source_products (
  id              uuid primary key default gen_random_uuid(),
  supplier_id     uuid not null references public.suppliers (id) on delete cascade,
  source_url      text not null,
  source_url_hash text generated always as (md5(lower(source_url))) stored,
  external_id     text,                    -- supplier's own product id when known
  title           text not null,
  description     text,
  images          jsonb not null default '[]'::jsonb,  -- [url, ...] original supplier images
  price           numeric(12,2) not null,              -- supplier cost, in `currency`
  currency        text not null default 'EGP',
  stock_status    public.source_status not null default 'active',
  stock_qty       int,
  raw_data        jsonb not null default '{}'::jsonb,  -- full scrape/API payload for debugging
  content_hash    text,                    -- md5 of (title, price, stock, variants) for change detection
  sync_tier       smallint not null default 2,         -- 1=hourly, 2=every 6h, 3=daily
  last_synced_at  timestamptz,
  status          public.source_status not null default 'active',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create unique index uq_source_products_url on public.source_products (source_url_hash);
create index idx_source_products_due on public.source_products (last_synced_at)
  where status <> 'removed';

create trigger trg_source_products_updated before update on public.source_products
  for each row execute function public.set_updated_at();

create table public.source_variants (
  id                uuid primary key default gen_random_uuid(),
  source_product_id uuid not null references public.source_products (id) on delete cascade,
  external_id       text,
  title             text not null,          -- "أحمر / XL"
  options           jsonb not null default '{}'::jsonb,  -- {"اللون":"أحمر","المقاس":"XL"}
  price             numeric(12,2),           -- null => same as product price
  stock_status      public.source_status not null default 'active',
  image_url         text,
  unique (source_product_id, external_id)
);

-- ---------- Pricing rules (ordered step pipeline, executed in @loqta/core) ----------
-- steps example:
-- [ {"type":"fx_buffer","pct":5},
--   {"type":"margin_pct","pct":30},
--   {"type":"add_fixed","amount":20},
--   {"type":"min_profit","amount":50},
--   {"type":"round_to_ending","ending":99} ]
create table public.pricing_rules (
  id         uuid primary key default gen_random_uuid(),
  store_id   uuid not null references public.stores (id) on delete cascade,
  name       text not null,
  is_default boolean not null default false,
  steps      jsonb not null,
  created_at timestamptz not null default now()
);

create unique index uq_pricing_rules_default
  on public.pricing_rules (store_id) where is_default;

-- Every new store gets a sane default rule automatically.
create or replace function public.seed_default_pricing_rule()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.pricing_rules (store_id, name, is_default, steps)
  values (
    new.id, 'القاعدة الافتراضية', true,
    '[{"type":"fx_buffer","pct":5},{"type":"margin_pct","pct":30},{"type":"round_to_ending","ending":99}]'::jsonb
  );
  return new;
end $$;

create trigger trg_store_default_rule
  after insert on public.stores
  for each row execute function public.seed_default_pricing_rule();

-- ---------- Listings (merchant side) ----------
create table public.listings (
  id                uuid primary key default gen_random_uuid(),
  store_id          uuid not null references public.stores (id) on delete cascade,
  source_product_id uuid not null references public.source_products (id) on delete restrict,
  slug              text not null,
  title_ar          text not null,
  title_en          text,
  description_ar    text,
  description_en    text,
  images            jsonb not null default '[]'::jsonb, -- curated/edited copies (may differ from source)
  currency          text not null default 'EGP',
  retail_price      numeric(12,2) not null,
  -- Snapshots at last (re)pricing — profit reports must never use live cost.
  cost_snapshot     numeric(12,2) not null,
  fx_rate_snapshot  numeric(14,6) not null default 1,
  price_mode        text not null default 'rule' check (price_mode in ('rule', 'manual')),
  pricing_rule_id   uuid references public.pricing_rules (id) on delete set null,
  status            public.listing_status not null default 'draft',
  paused_reason     text,
  ai_generated      boolean not null default false,
  seo               jsonb not null default '{}'::jsonb, -- {meta_title, meta_description, keywords[]}
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (store_id, source_product_id),
  unique (store_id, slug)
);

create index idx_listings_store on public.listings (store_id, status);
create index idx_listings_source on public.listings (source_product_id);

create trigger trg_listings_updated before update on public.listings
  for each row execute function public.set_updated_at();

create table public.listing_variants (
  id                uuid primary key default gen_random_uuid(),
  listing_id        uuid not null references public.listings (id) on delete cascade,
  source_variant_id uuid not null references public.source_variants (id) on delete cascade,
  retail_price      numeric(12,2),          -- null => listing.retail_price
  is_enabled        boolean not null default true,
  unique (listing_id, source_variant_id)
);

-- ---------- Public storefront views ----------
-- WHY VIEWS: RLS is row-level, not column-level. Exposing `listings` to anon
-- would leak cost_snapshot (the merchant's cost!). These views expose only
-- safe columns and only active rows. They run as owner (postgres), so grant
-- SELECT explicitly.
create view public.storefront_stores as
  select id, name, slug, logo_url, currency,
         settings -> 'theme' as theme
  from public.stores;

create view public.storefront_listings as
  select l.id, l.store_id, l.slug, l.title_ar, l.title_en,
         l.description_ar, l.description_en, l.images,
         l.retail_price, l.currency, l.created_at,
         sp.stock_status
  from public.listings l
  join public.source_products sp on sp.id = l.source_product_id
  where l.status = 'active';

grant select on public.storefront_stores  to anon, authenticated;
grant select on public.storefront_listings to anon, authenticated;
