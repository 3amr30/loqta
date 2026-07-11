-- =============================================================
-- Loqta (لقطة) — 01: extensions, enums, helpers
-- =============================================================

create extension if not exists pgcrypto;

-- ---------- Enums ----------
create type public.supplier_type as enum ('local', 'aliexpress', 'generic');
create type public.supplier_visibility as enum ('platform', 'private');

create type public.source_status as enum ('active', 'out_of_stock', 'removed', 'error');
create type public.listing_status as enum ('draft', 'active', 'paused', 'archived');

-- What happens to a merchant's listings when the supplier source changes:
--   pause_only       -> only auto-pause on out-of-stock (safe default)
--   auto_apply       -> auto-update cost + recompute retail price from the pricing rule
--   require_approval -> just notify; merchant approves changes manually
create type public.sync_policy as enum ('pause_only', 'auto_apply', 'require_approval');

create type public.order_status as enum
  ('pending', 'confirmed', 'fulfilled', 'shipped', 'delivered', 'cancelled', 'returned');
create type public.payment_method as enum ('cod', 'paymob', 'stripe');
create type public.payment_status as enum ('pending', 'paid', 'refunded', 'failed');

create type public.job_status as enum ('queued', 'processing', 'done', 'failed');

create type public.sync_event_type as enum
  ('price_change', 'stock_change', 'content_change', 'restored', 'error');

create type public.notification_type as enum
  ('import_done', 'import_failed', 'price_changed', 'out_of_stock',
   'back_in_stock', 'new_order', 'sync_error');

-- ---------- Helper functions ----------

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- True when the authenticated user owns the given store.
-- SECURITY DEFINER so it can be used inside RLS policies of other tables.
create or replace function public.is_store_owner(sid uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from stores where id = sid and merchant_id = auth.uid()
  );
$$;

create or replace function public.is_admin()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from profiles where id = auth.uid() and role = 'admin'
  );
$$;

-- Auto-create a profile row for every new auth user.
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', ''))
  on conflict (id) do nothing;
  return new;
end $$;
