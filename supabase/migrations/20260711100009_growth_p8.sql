-- =============================================================
-- Loqta — 09: growth P8 (order confirmation, trust, OTP)
-- =============================================================
-- NB: filename orders before 010; both ALTER orders but disjoint columns
-- (09 = whatsapp_confirmation_*, 10 = discount_*) — no conflict.

-- ---------- WhatsApp order-confirmation state ----------
alter table public.orders
  add column whatsapp_confirmation_status text
    check (whatsapp_confirmation_status in ('sent','confirmed','declined','no_response')),
  add column whatsapp_confirmed_at timestamptz;

-- Checkout hot path: needsOtp / block-threshold / trust lookups are all
-- WHERE store_id = $1 AND customer_phone = $2 — this composite serves that
-- exact query (and the view's group by); it is not a general-purpose index.
create index idx_orders_phone on public.orders (store_id, customer_phone);

-- ---------- Per-store trust aggregate (live view, no drift) ----------
-- Owner-scoped through the API (service pool); no anon grant.
create view public.customer_order_history as
  select store_id, customer_phone,
         count(*)::int as total,
         count(*) filter (where status in ('confirmed','fulfilled','shipped','delivered'))::int as confirmed,
         count(*) filter (where status = 'cancelled')::int as cancelled,
         count(*) filter (where status = 'returned')::int as returned
  from public.orders
  group by store_id, customer_phone;

alter type public.notification_type add value if not exists 'order_flagged';
