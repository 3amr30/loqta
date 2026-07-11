-- =============================================================
-- Loqta — 04: orders, import intake, sync events, notifications
-- =============================================================

-- ---------- Orders (COD-first) ----------
create table public.orders (
  id               uuid primary key default gen_random_uuid(),
  store_id         uuid not null references public.stores (id) on delete cascade,
  order_number     text not null,
  customer_name    text not null,
  customer_phone   text not null,          -- primary identity for COD in Egypt
  customer_email   text,
  governorate      text,
  shipping_address jsonb not null,         -- {line, city, governorate, notes}
  payment_method   public.payment_method not null default 'cod',
  payment_status   public.payment_status not null default 'pending',
  status           public.order_status not null default 'pending',
  currency         text not null default 'EGP',
  subtotal         numeric(12,2) not null,
  shipping_fee     numeric(12,2) not null default 0,
  total            numeric(12,2) not null,
  total_cost       numeric(12,2) not null, -- sum of supplier cost snapshots (profit reporting)
  notes            text,
  supplier_notified_at timestamptz,        -- WhatsApp/CSV fulfillment sent
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (store_id, order_number)
);

create index idx_orders_store on public.orders (store_id, created_at desc);

create trigger trg_orders_updated before update on public.orders
  for each row execute function public.set_updated_at();

-- Per-store human-friendly order numbers: LQ-000001, LQ-000002 ...
create or replace function public.assign_order_number()
returns trigger language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update public.stores
     set order_counter = order_counter + 1
   where id = new.store_id
   returning order_counter into n;
  new.order_number := 'LQ-' || lpad(n::text, 6, '0');
  return new;
end $$;

create trigger trg_order_number
  before insert on public.orders
  for each row
  when (new.order_number is null or new.order_number = '')
  execute function public.assign_order_number();

create table public.order_items (
  id                 uuid primary key default gen_random_uuid(),
  order_id           uuid not null references public.orders (id) on delete cascade,
  listing_id         uuid references public.listings (id) on delete set null,
  source_product_id  uuid references public.source_products (id) on delete set null,
  source_variant_id  uuid references public.source_variants (id) on delete set null,
  supplier_id        uuid references public.suppliers (id) on delete set null,
  title_snapshot     text not null,
  variant_snapshot   text,
  qty                int not null check (qty > 0),
  unit_price         numeric(12,2) not null,  -- what the customer pays
  unit_cost_snapshot numeric(12,2) not null,  -- supplier cost at order time
  fx_rate_snapshot   numeric(14,6) not null default 1
);

create index idx_order_items_order on public.order_items (order_id);

-- ---------- Import intake (web -> worker boundary) ----------
-- The dashboard INSERTs here (RLS-protected). The worker sweeps queued rows,
-- claims them with FOR UPDATE SKIP LOCKED, and runs them through pg-boss
-- (which adds retries/backoff). Decoupled: web never talks to the queue.
create table public.import_jobs (
  id                uuid primary key default gen_random_uuid(),
  store_id          uuid not null references public.stores (id) on delete cascade,
  requested_by      uuid not null references public.profiles (id),
  url               text not null,
  supplier_id       uuid references public.suppliers (id), -- optional: pin to a known supplier
  status            public.job_status not null default 'queued',
  error             text,
  source_product_id uuid references public.source_products (id),
  listing_id        uuid references public.listings (id),
  created_at        timestamptz not null default now(),
  processed_at      timestamptz
);

create index idx_import_jobs_queued on public.import_jobs (created_at)
  where status = 'queued';

-- ---------- Sync audit trail ----------
create table public.sync_events (
  id                uuid primary key default gen_random_uuid(),
  source_product_id uuid not null references public.source_products (id) on delete cascade,
  event_type        public.sync_event_type not null,
  old_value         jsonb,
  new_value         jsonb,
  created_at        timestamptz not null default now()
);

create index idx_sync_events_source on public.sync_events (source_product_id, created_at desc);

-- ---------- Notifications (dashboard bell, Supabase Realtime-friendly) ----------
create table public.notifications (
  id         uuid primary key default gen_random_uuid(),
  store_id   uuid not null references public.stores (id) on delete cascade,
  type       public.notification_type not null,
  title      text not null,
  body       text,
  data       jsonb not null default '{}'::jsonb,
  read_at    timestamptz,
  created_at timestamptz not null default now()
);

create index idx_notifications_store on public.notifications (store_id, created_at desc);

-- ---------- Storage buckets ----------
insert into storage.buckets (id, name, public) values
  ('product-images', 'product-images', true),
  ('store-assets',   'store-assets',   true)
on conflict (id) do nothing;

create policy "public read product images" on storage.objects
  for select using (bucket_id in ('product-images', 'store-assets'));
-- Writes: worker uses the service role (bypasses RLS). Merchant logo upload
-- policies come with the dashboard settings page (Phase 1).
