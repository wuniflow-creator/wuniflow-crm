
alter table public.whatsapp_conversations
  add column if not exists service_priority text not null default 'normal',
  add column if not exists last_inbound_at timestamptz,
  add column if not exists last_outbound_at timestamptz,
  add column if not exists awaiting_response_since timestamptz;

alter table public.whatsapp_conversations
  drop constraint if exists whatsapp_conversations_service_priority_check;

alter table public.whatsapp_conversations
  add constraint whatsapp_conversations_service_priority_check
  check (service_priority in ('low','normal','high','urgent'));

create index if not exists whatsapp_conversations_sla_queue_idx
  on public.whatsapp_conversations
  (organization_id, service_priority, awaiting_response_since)
  where awaiting_response_since is not null;

create table if not exists public.whatsapp_inbox_settings (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  sla_low_minutes integer not null default 240,
  sla_normal_minutes integer not null default 120,
  sla_high_minutes integer not null default 60,
  sla_urgent_minutes integer not null default 30,
  created_by uuid not null default auth.uid() references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint whatsapp_inbox_settings_low_check check (sla_low_minutes between 5 and 10080),
  constraint whatsapp_inbox_settings_normal_check check (sla_normal_minutes between 5 and 10080),
  constraint whatsapp_inbox_settings_high_check check (sla_high_minutes between 5 and 10080),
  constraint whatsapp_inbox_settings_urgent_check check (sla_urgent_minutes between 5 and 10080)
);

alter table public.whatsapp_inbox_settings enable row level security;

drop policy if exists whatsapp_inbox_settings_select on public.whatsapp_inbox_settings;
create policy whatsapp_inbox_settings_select
on public.whatsapp_inbox_settings
for select to authenticated
using (
  private.current_user_has_org_role(
    organization_id,
    array['owner','admin','manager','agent']::text[]
  )
);

drop policy if exists whatsapp_inbox_settings_insert on public.whatsapp_inbox_settings;
create policy whatsapp_inbox_settings_insert
on public.whatsapp_inbox_settings
for insert to authenticated
with check (
  created_by = auth.uid()
  and private.current_user_has_org_role(
    organization_id,
    array['owner','admin','manager']::text[]
  )
);

drop policy if exists whatsapp_inbox_settings_update on public.whatsapp_inbox_settings;
create policy whatsapp_inbox_settings_update
on public.whatsapp_inbox_settings
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

insert into public.whatsapp_inbox_settings (
  organization_id,
  created_by
)
select o.id, o.created_by
from public.organizations o
on conflict (organization_id) do nothing;

create or replace function private.refresh_whatsapp_sla_clock()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  msg_at timestamptz := coalesce(new.sent_at, new.created_at, now());
begin
  if new.direction = 'inbound' then
    update public.whatsapp_conversations wc
       set last_inbound_at = greatest(coalesce(wc.last_inbound_at, msg_at), msg_at),
           awaiting_response_since =
             case
               when msg_at >= coalesce(wc.last_outbound_at, '-infinity'::timestamptz)
                and msg_at >= coalesce(wc.last_inbound_at, '-infinity'::timestamptz)
               then msg_at
               else wc.awaiting_response_since
             end,
           updated_at = now()
     where wc.id = new.conversation_id
       and wc.organization_id = new.organization_id;
  elsif new.direction = 'outbound' then
    update public.whatsapp_conversations wc
       set last_outbound_at = greatest(coalesce(wc.last_outbound_at, msg_at), msg_at),
           awaiting_response_since =
             case
               when msg_at >= coalesce(wc.last_inbound_at, '-infinity'::timestamptz)
               then null
               else wc.awaiting_response_since
             end,
           updated_at = now()
     where wc.id = new.conversation_id
       and wc.organization_id = new.organization_id;
  end if;

  return new;
end;
$function$;

drop trigger if exists trg_refresh_whatsapp_sla_clock
on public.whatsapp_messages;

create trigger trg_refresh_whatsapp_sla_clock
after insert on public.whatsapp_messages
for each row
execute function private.refresh_whatsapp_sla_clock();

with message_rollup as (
  select
    wm.organization_id,
    wm.conversation_id,
    max(coalesce(wm.sent_at, wm.created_at)) filter (where wm.direction = 'inbound') as last_inbound_at,
    max(coalesce(wm.sent_at, wm.created_at)) filter (where wm.direction = 'outbound') as last_outbound_at
  from public.whatsapp_messages wm
  group by wm.organization_id, wm.conversation_id
)
update public.whatsapp_conversations wc
set last_inbound_at = mr.last_inbound_at,
    last_outbound_at = mr.last_outbound_at,
    awaiting_response_since =
      case
        when mr.last_inbound_at is not null
         and mr.last_inbound_at > coalesce(mr.last_outbound_at, '-infinity'::timestamptz)
        then mr.last_inbound_at
        else null
      end
from message_rollup mr
where wc.organization_id = mr.organization_id
  and wc.id = mr.conversation_id;
