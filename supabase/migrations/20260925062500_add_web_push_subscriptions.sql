
create table if not exists public.web_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  user_agent text,
  device_name text,
  is_active boolean not null default true,
  failure_count integer not null default 0,
  last_error text,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint web_push_subscriptions_crypto_check
    check (char_length(p256dh) between 40 and 200 and char_length(auth) between 8 and 100),
  constraint web_push_subscriptions_endpoint_unique unique (endpoint)
);

create index if not exists web_push_subscriptions_user_idx
on public.web_push_subscriptions (organization_id, user_id, is_active);

alter table public.web_push_subscriptions enable row level security;

drop policy if exists web_push_subscriptions_select_own on public.web_push_subscriptions;
create policy web_push_subscriptions_select_own
on public.web_push_subscriptions
for select to authenticated
using (
  user_id = auth.uid()
  and private.current_user_has_org_role(
    organization_id,
    array['owner','admin','manager','agent']::text[]
  )
);

drop policy if exists web_push_subscriptions_insert_own on public.web_push_subscriptions;
create policy web_push_subscriptions_insert_own
on public.web_push_subscriptions
for insert to authenticated
with check (
  user_id = auth.uid()
  and private.current_user_has_org_role(
    organization_id,
    array['owner','admin','manager','agent']::text[]
  )
);

drop policy if exists web_push_subscriptions_update_own on public.web_push_subscriptions;
create policy web_push_subscriptions_update_own
on public.web_push_subscriptions
for update to authenticated
using (
  user_id = auth.uid()
  and private.current_user_has_org_role(
    organization_id,
    array['owner','admin','manager','agent']::text[]
  )
)
with check (
  user_id = auth.uid()
  and private.current_user_has_org_role(
    organization_id,
    array['owner','admin','manager','agent']::text[]
  )
);

drop policy if exists web_push_subscriptions_delete_own on public.web_push_subscriptions;
create policy web_push_subscriptions_delete_own
on public.web_push_subscriptions
for delete to authenticated
using (
  user_id = auth.uid()
  and private.current_user_has_org_role(
    organization_id,
    array['owner','admin','manager','agent']::text[]
  )
);

create or replace function public.get_web_push_vapid_private()
returns text
language sql
security definer
set search_path = ''
as $function$
  select ds.decrypted_secret
  from vault.decrypted_secrets ds
  where ds.name = 'wuniflow_web_push_vapid_private'
  order by ds.updated_at desc
  limit 1;
$function$;

revoke all on function public.get_web_push_vapid_private() from public;
revoke all on function public.get_web_push_vapid_private() from authenticated;
grant execute on function public.get_web_push_vapid_private() to service_role;
