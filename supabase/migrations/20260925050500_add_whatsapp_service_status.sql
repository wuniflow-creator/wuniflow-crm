
alter table public.whatsapp_conversations
add column if not exists service_status text not null default 'new',
add column if not exists service_status_updated_at timestamptz not null default now();

alter table public.whatsapp_conversations
drop constraint if exists whatsapp_conversations_service_status_check;

alter table public.whatsapp_conversations
add constraint whatsapp_conversations_service_status_check
check (service_status in ('new','in_progress','waiting_customer','resolved'));

create index if not exists whatsapp_conversations_service_status_idx
on public.whatsapp_conversations (organization_id, service_status, last_message_at desc);

create or replace function private.advance_whatsapp_service_status_from_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  current_status text;
begin
  select wc.service_status
    into current_status
  from public.whatsapp_conversations wc
  where wc.id = new.conversation_id
    and wc.organization_id = new.organization_id
  for update;

  if current_status is null then
    return new;
  end if;

  if new.direction = 'inbound' then
    if current_status = 'resolved' then
      update public.whatsapp_conversations
      set service_status = 'new',
          service_status_updated_at = now(),
          status = case when status = 'archived' then 'open' else status end,
          updated_at = now()
      where id = new.conversation_id
        and organization_id = new.organization_id;
    elsif current_status = 'waiting_customer' then
      update public.whatsapp_conversations
      set service_status = 'in_progress',
          service_status_updated_at = now(),
          updated_at = now()
      where id = new.conversation_id
        and organization_id = new.organization_id;
    end if;
  elsif new.direction = 'outbound' and current_status = 'new' then
    update public.whatsapp_conversations
    set service_status = 'in_progress',
        service_status_updated_at = now(),
        updated_at = now()
    where id = new.conversation_id
      and organization_id = new.organization_id;
  end if;

  return new;
end;
$function$;

drop trigger if exists trg_advance_whatsapp_service_status_from_message
on public.whatsapp_messages;

create trigger trg_advance_whatsapp_service_status_from_message
after insert on public.whatsapp_messages
for each row
execute function private.advance_whatsapp_service_status_from_message();

create or replace function private.advance_whatsapp_service_status_from_assignment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if new.assigned_to is not null
     and old.assigned_to is distinct from new.assigned_to
     and new.service_status = 'new' then
    new.service_status := 'in_progress';
    new.service_status_updated_at := now();
  end if;

  return new;
end;
$function$;

drop trigger if exists trg_advance_whatsapp_service_status_from_assignment
on public.whatsapp_conversations;

create trigger trg_advance_whatsapp_service_status_from_assignment
before update of assigned_to on public.whatsapp_conversations
for each row
execute function private.advance_whatsapp_service_status_from_assignment();
