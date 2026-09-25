
create or replace function private.validate_whatsapp_conversation_assignee()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if new.assigned_to is null then
    return new;
  end if;

  if not exists (
    select 1
    from public.organization_members om
    where om.organization_id = new.organization_id
      and om.user_id = new.assigned_to
      and om.is_active = true
  ) then
    raise exception 'whatsapp_assignee_must_be_active_org_member'
      using errcode = '23514';
  end if;

  return new;
end;
$function$;

drop trigger if exists trg_validate_whatsapp_conversation_assignee
on public.whatsapp_conversations;

create trigger trg_validate_whatsapp_conversation_assignee
before insert or update of assigned_to, organization_id
on public.whatsapp_conversations
for each row
execute function private.validate_whatsapp_conversation_assignee();
