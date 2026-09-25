
create table if not exists public.whatsapp_tags (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  color text not null default '#8b5cf6',
  created_by uuid not null default auth.uid() references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint whatsapp_tags_name_check check (char_length(btrim(name)) between 1 and 32),
  constraint whatsapp_tags_color_check check (color ~ '^#[0-9A-Fa-f]{6}$'),
  constraint whatsapp_tags_id_org_key unique (id, organization_id)
);

create unique index if not exists whatsapp_tags_org_name_unique
on public.whatsapp_tags (organization_id, lower(btrim(name)));

create table if not exists public.whatsapp_conversation_tags (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  conversation_id uuid not null,
  tag_id uuid not null,
  created_by uuid not null default auth.uid() references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (conversation_id, tag_id),
  constraint whatsapp_conversation_tags_conversation_fk
    foreign key (conversation_id, organization_id)
    references public.whatsapp_conversations(id, organization_id)
    on delete cascade,
  constraint whatsapp_conversation_tags_tag_fk
    foreign key (tag_id, organization_id)
    references public.whatsapp_tags(id, organization_id)
    on delete cascade
);

create index if not exists whatsapp_conversation_tags_org_idx
on public.whatsapp_conversation_tags (organization_id, conversation_id);

create table if not exists public.whatsapp_conversation_notes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  conversation_id uuid not null,
  body text not null,
  created_by uuid not null default auth.uid() references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint whatsapp_conversation_notes_body_check check (char_length(btrim(body)) between 1 and 4000),
  constraint whatsapp_conversation_notes_conversation_fk
    foreign key (conversation_id, organization_id)
    references public.whatsapp_conversations(id, organization_id)
    on delete cascade
);

create index if not exists whatsapp_conversation_notes_lookup_idx
on public.whatsapp_conversation_notes (organization_id, conversation_id, created_at desc);

alter table public.whatsapp_tags enable row level security;
alter table public.whatsapp_conversation_tags enable row level security;
alter table public.whatsapp_conversation_notes enable row level security;

drop policy if exists whatsapp_tags_select on public.whatsapp_tags;
create policy whatsapp_tags_select on public.whatsapp_tags
for select to authenticated
using (
  private.current_user_has_org_role(
    organization_id,
    array['owner','admin','manager','agent']::text[]
  )
);

drop policy if exists whatsapp_tags_insert on public.whatsapp_tags;
create policy whatsapp_tags_insert on public.whatsapp_tags
for insert to authenticated
with check (
  created_by = auth.uid()
  and private.current_user_has_org_role(
    organization_id,
    array['owner','admin','manager','agent']::text[]
  )
);

drop policy if exists whatsapp_tags_update on public.whatsapp_tags;
create policy whatsapp_tags_update on public.whatsapp_tags
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

drop policy if exists whatsapp_tags_delete on public.whatsapp_tags;
create policy whatsapp_tags_delete on public.whatsapp_tags
for delete to authenticated
using (
  private.current_user_has_org_role(
    organization_id,
    array['owner','admin','manager']::text[]
  )
);

drop policy if exists whatsapp_conversation_tags_select on public.whatsapp_conversation_tags;
create policy whatsapp_conversation_tags_select on public.whatsapp_conversation_tags
for select to authenticated
using (
  private.current_user_has_org_role(
    organization_id,
    array['owner','admin','manager','agent']::text[]
  )
);

drop policy if exists whatsapp_conversation_tags_insert on public.whatsapp_conversation_tags;
create policy whatsapp_conversation_tags_insert on public.whatsapp_conversation_tags
for insert to authenticated
with check (
  created_by = auth.uid()
  and private.current_user_has_org_role(
    organization_id,
    array['owner','admin','manager','agent']::text[]
  )
);

drop policy if exists whatsapp_conversation_tags_delete on public.whatsapp_conversation_tags;
create policy whatsapp_conversation_tags_delete on public.whatsapp_conversation_tags
for delete to authenticated
using (
  private.current_user_has_org_role(
    organization_id,
    array['owner','admin','manager','agent']::text[]
  )
);

drop policy if exists whatsapp_conversation_notes_select on public.whatsapp_conversation_notes;
create policy whatsapp_conversation_notes_select on public.whatsapp_conversation_notes
for select to authenticated
using (
  private.current_user_has_org_role(
    organization_id,
    array['owner','admin','manager','agent']::text[]
  )
);

drop policy if exists whatsapp_conversation_notes_insert on public.whatsapp_conversation_notes;
create policy whatsapp_conversation_notes_insert on public.whatsapp_conversation_notes
for insert to authenticated
with check (
  created_by = auth.uid()
  and private.current_user_has_org_role(
    organization_id,
    array['owner','admin','manager','agent']::text[]
  )
);

drop policy if exists whatsapp_conversation_notes_update on public.whatsapp_conversation_notes;
create policy whatsapp_conversation_notes_update on public.whatsapp_conversation_notes
for update to authenticated
using (
  created_by = auth.uid()
  or private.current_user_has_org_role(
    organization_id,
    array['owner','admin','manager']::text[]
  )
)
with check (
  created_by = auth.uid()
  or private.current_user_has_org_role(
    organization_id,
    array['owner','admin','manager']::text[]
  )
);

drop policy if exists whatsapp_conversation_notes_delete on public.whatsapp_conversation_notes;
create policy whatsapp_conversation_notes_delete on public.whatsapp_conversation_notes
for delete to authenticated
using (
  created_by = auth.uid()
  or private.current_user_has_org_role(
    organization_id,
    array['owner','admin','manager']::text[]
  )
);
