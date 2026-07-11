-- =============================================================
-- Loqta — 06: API delta (approved plan §4). Strictly additive;
-- migrations 001-005 stay byte-for-byte.
-- =============================================================

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
--    (view recreated with one added column — safe for create or replace)
create or replace view public.storefront_stores as
  select id, name, slug, logo_url, currency,
         settings -> 'theme' as theme,
         coalesce((settings ->> 'shipping_fee')::numeric, 0) as shipping_fee
  from public.stores;

-- 4. Notification type for AI rewrite completion
--    (generate-content currently mislabels it as import_done)
alter type public.notification_type add value if not exists 'content_ready';
