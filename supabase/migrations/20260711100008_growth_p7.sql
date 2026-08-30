-- =============================================================
-- Loqta — 08: growth P7 (reviews, storefront store extras)
-- =============================================================

-- ---------- Product reviews (verified purchase only) ----------
-- Submission is gated server-side: the (order_number, phone) pair must match
-- a non-cancelled order of this store that contains the listing. One review
-- per purchased line. Public storefront reads only status='approved' rows,
-- through the API (service pool) — no anon grant on the base table.
create table public.product_reviews (
  id         uuid primary key default gen_random_uuid(),
  store_id   uuid not null references public.stores (id) on delete cascade,
  listing_id uuid not null references public.listings (id) on delete cascade,
  order_id   uuid references public.orders (id) on delete set null,
  rating     smallint not null check (rating between 1 and 5),
  comment    text,
  buyer_name text not null,
  status     text not null default 'pending'
             check (status in ('pending','approved','rejected')),
  created_at timestamptz not null default now(),
  unique (order_id, listing_id)
);

create index idx_reviews_listing on public.product_reviews (listing_id, status);
create index idx_reviews_store on public.product_reviews (store_id, status, created_at desc);

alter table public.product_reviews enable row level security;
create policy "owner: read reviews" on public.product_reviews
  for select using (is_store_owner(store_id));
create policy "owner: moderate reviews" on public.product_reviews
  for update using (is_store_owner(store_id));

alter type public.notification_type add value if not exists 'review_pending';

-- ---------- storefront_stores: low-stock threshold + WhatsApp button ----------
-- Appends two non-sensitive columns at the end (create-or-replace safe).
create or replace view public.storefront_stores as
  select id, name, slug, logo_url, currency,
         settings -> 'theme' as theme,
         coalesce((settings ->> 'shipping_fee')::numeric, 0) as shipping_fee,
         coalesce((settings ->> 'low_stock_threshold')::int, 5) as low_stock_threshold,
         whatsapp_phone
  from public.stores;
