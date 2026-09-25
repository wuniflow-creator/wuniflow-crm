
create table if not exists public.whatsapp_quick_replies (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  title text not null,
  shortcut text not null,
  body text not null,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_by uuid not null default auth.uid() references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint whatsapp_quick_replies_title_check check (char_length(btrim(title)) between 1 and 80),
  constraint whatsapp_quick_replies_shortcut_check check (shortcut ~ '^/[A-Za-z0-9_-]{1,32}$'),
  constraint whatsapp_quick_replies_body_check check (char_length(btrim(body)) between 1 and 4096)
);

create unique index if not exists whatsapp_quick_replies_org_shortcut_unique
on public.whatsapp_quick_replies (organization_id, lower(shortcut));

create index if not exists whatsapp_quick_replies_org_active_sort_idx
on public.whatsapp_quick_replies (organization_id, is_active, sort_order, title);

alter table public.whatsapp_quick_replies enable row level security;

drop policy if exists whatsapp_quick_replies_select on public.whatsapp_quick_replies;
create policy whatsapp_quick_replies_select
on public.whatsapp_quick_replies
for select to authenticated
using (
  private.current_user_has_org_role(
    organization_id,
    array['owner','admin','manager','agent']::text[]
  )
);

drop policy if exists whatsapp_quick_replies_insert on public.whatsapp_quick_replies;
create policy whatsapp_quick_replies_insert
on public.whatsapp_quick_replies
for insert to authenticated
with check (
  created_by = auth.uid()
  and private.current_user_has_org_role(
    organization_id,
    array['owner','admin','manager']::text[]
  )
);

drop policy if exists whatsapp_quick_replies_update on public.whatsapp_quick_replies;
create policy whatsapp_quick_replies_update
on public.whatsapp_quick_replies
for update to authenticated
using (
  private.current_user_has_org_role(
    organization_id,
    array['owner','admin','manager']::text[]
  )
)
with check (
  private.current_user_has_org_role(
    organization_id,
    array['owner','admin','manager']::text[]
  )
);

drop policy if exists whatsapp_quick_replies_delete on public.whatsapp_quick_replies;
create policy whatsapp_quick_replies_delete
on public.whatsapp_quick_replies
for delete to authenticated
using (
  private.current_user_has_org_role(
    organization_id,
    array['owner','admin','manager']::text[]
  )
);

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname='supabase_realtime'
      and schemaname='public'
      and tablename='whatsapp_quick_replies'
  ) then
    alter publication supabase_realtime add table public.whatsapp_quick_replies;
  end if;
end $$;
