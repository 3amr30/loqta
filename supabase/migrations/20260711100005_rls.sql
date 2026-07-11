-- =============================================================
-- Loqta — 05: Row Level Security
--
-- Tenancy model: everything hangs off stores.merchant_id = auth.uid()
-- via is_store_owner(). The worker uses the service role and bypasses
-- RLS entirely. Anonymous storefront traffic reads ONLY the
-- storefront_* views (migration 03) — never the base tables.
-- =============================================================

alter table public.profiles                  enable row level security;
alter table public.plans                     enable row level security;
alter table public.subscriptions             enable row level security;
alter table public.stores                    enable row level security;
alter table public.store_payment_credentials enable row level security;
alter table public.suppliers                 enable row level security;
alter table public.fx_rates                  enable row level security;
alter table public.source_products           enable row level security;
alter table public.source_variants           enable row level security;
alter table public.pricing_rules             enable row level security;
alter table public.listings                  enable row level security;
alter table public.listing_variants          enable row level security;
alter table public.orders                    enable row level security;
alter table public.order_items               enable row level security;
alter table public.import_jobs               enable row level security;
alter table public.sync_events               enable row level security;
alter table public.notifications             enable row level security;

-- ---------- profiles ----------
create policy "own profile: read"   on public.profiles for select using (id = auth.uid() or is_admin());
create policy "own profile: update" on public.profiles for update using (id = auth.uid());

-- ---------- plans / subscriptions ----------
create policy "plans are public" on public.plans for select using (is_active);
create policy "own subscription" on public.subscriptions for select using (merchant_id = auth.uid());

-- ---------- stores ----------
create policy "owner: full access" on public.stores
  for all using (merchant_id = auth.uid()) with check (merchant_id = auth.uid());
create policy "admin: read stores" on public.stores for select using (is_admin());

-- ---------- store_payment_credentials ----------
-- TODO(security): encrypt via Vault before production merchant keys.
create policy "owner: gateway keys" on public.store_payment_credentials
  for all using (is_store_owner(store_id)) with check (is_store_owner(store_id));

-- ---------- suppliers ----------
-- Platform suppliers visible to every logged-in merchant; private ones to owner.
create policy "merchants browse suppliers" on public.suppliers
  for select using (
    (visibility = 'platform' and is_active)
    or is_store_owner(owner_store_id)
    or is_admin()
  );
create policy "owner: private suppliers" on public.suppliers
  for insert with check (visibility = 'private' and is_store_owner(owner_store_id));

-- ---------- fx_rates ----------
create policy "fx readable by merchants" on public.fx_rates
  for select using (auth.role() = 'authenticated');

-- ---------- source catalog (write path is worker/service-role only) ----------
create policy "merchants browse sources" on public.source_products
  for select using (
    exists (
      select 1 from public.suppliers sp
      where sp.id = supplier_id
        and (sp.visibility = 'platform' or is_store_owner(sp.owner_store_id))
    )
  );

create policy "merchants browse source variants" on public.source_variants
  for select using (
    exists (
      select 1
      from public.source_products p
      join public.suppliers sp on sp.id = p.supplier_id
      where p.id = source_product_id
        and (sp.visibility = 'platform' or is_store_owner(sp.owner_store_id))
    )
  );

-- ---------- pricing_rules ----------
create policy "owner: pricing rules" on public.pricing_rules
  for all using (is_store_owner(store_id)) with check (is_store_owner(store_id));

-- ---------- listings ----------
-- NOTE: no anon policy on purpose — cost_snapshot lives here.
-- Storefront reads go through the storefront_listings view.
create policy "owner: listings" on public.listings
  for all using (is_store_owner(store_id)) with check (is_store_owner(store_id));

create policy "owner: listing variants" on public.listing_variants
  for all using (
    exists (select 1 from public.listings l
            where l.id = listing_id and is_store_owner(l.store_id))
  ) with check (
    exists (select 1 from public.listings l
            where l.id = listing_id and is_store_owner(l.store_id))
  );

-- ---------- orders ----------
-- INSERT intentionally has NO policy: checkout runs server-side with the
-- service role after re-validating prices against the DB (never trust the
-- client's cart totals).
create policy "owner: read orders"   on public.orders for select using (is_store_owner(store_id));
create policy "owner: update orders" on public.orders for update using (is_store_owner(store_id));

create policy "owner: read order items" on public.order_items
  for select using (
    exists (select 1 from public.orders o
            where o.id = order_id and is_store_owner(o.store_id))
  );

-- ---------- import_jobs ----------
create policy "owner: request import" on public.import_jobs
  for insert with check (is_store_owner(store_id) and requested_by = auth.uid());
create policy "owner: track imports" on public.import_jobs
  for select using (is_store_owner(store_id));

-- ---------- sync_events ----------
-- A merchant may read events for any source they have a listing on.
create policy "merchants read relevant sync events" on public.sync_events
  for select using (
    exists (
      select 1 from public.listings l
      where l.source_product_id = sync_events.source_product_id
        and is_store_owner(l.store_id)
    )
  );

-- ---------- notifications ----------
create policy "owner: read notifications" on public.notifications
  for select using (is_store_owner(store_id));
create policy "owner: mark read" on public.notifications
  for update using (is_store_owner(store_id));
