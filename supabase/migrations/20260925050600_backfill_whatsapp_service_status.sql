
update public.whatsapp_conversations wc
set service_status = case
      when wc.status = 'closed' then 'resolved'
      when wc.status = 'pending' then 'waiting_customer'
      when exists (
        select 1
        from public.whatsapp_messages wm
        where wm.organization_id = wc.organization_id
          and wm.conversation_id = wc.id
          and wm.direction = 'outbound'
      ) then 'in_progress'
      else 'new'
    end,
    service_status_updated_at = coalesce(wc.last_message_at, wc.updated_at, now())
where wc.service_status = 'new';
