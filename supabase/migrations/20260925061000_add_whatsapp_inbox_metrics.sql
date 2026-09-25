
create or replace function public.get_whatsapp_inbox_metrics(
  p_organization_id uuid,
  p_days integer default 30
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_days integer := case when p_days in (7, 30, 90) then p_days else 30 end;
  v_since timestamptz := now() - make_interval(days => case when p_days in (7, 30, 90) then p_days else 30 end);
  v_result jsonb;
begin
  if auth.uid() is null or not private.current_user_has_org_role(
    p_organization_id,
    array['owner','admin','manager','agent']::text[]
  ) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  with
  settings as (
    select
      coalesce(s.sla_low_minutes, 240) as sla_low_minutes,
      coalesce(s.sla_normal_minutes, 120) as sla_normal_minutes,
      coalesce(s.sla_high_minutes, 60) as sla_high_minutes,
      coalesce(s.sla_urgent_minutes, 30) as sla_urgent_minutes
    from (select 1) seed
    left join public.whatsapp_inbox_settings s
      on s.organization_id = p_organization_id
  ),
  period_messages as (
    select
      wm.id,
      wm.conversation_id,
      wm.direction,
      wm.message_type,
      coalesce(wm.sent_at, wm.created_at) as message_at
    from public.whatsapp_messages wm
    where wm.organization_id = p_organization_id
      and coalesce(wm.sent_at, wm.created_at) >= v_since
  ),
  inbound_response as (
    select
      i.id,
      i.message_at,
      (
        select min(coalesce(o.sent_at, o.created_at))
        from public.whatsapp_messages o
        where o.organization_id = p_organization_id
          and o.conversation_id = i.conversation_id
          and o.direction = 'outbound'
          and coalesce(o.sent_at, o.created_at) > i.message_at
      ) as response_at
    from period_messages i
    where i.direction = 'inbound'
  ),
  response_stats as (
    select
      round(avg(extract(epoch from (response_at - message_at)) / 60.0)::numeric, 1) as avg_response_minutes,
      count(*) filter (where response_at is not null) as answered_inbound
    from inbound_response
    where response_at is not null
  ),
  queue as (
    select
      count(*) filter (where wc.status <> 'archived' and wc.service_status = 'new') as new_count,
      count(*) filter (where wc.status <> 'archived' and wc.service_status = 'in_progress') as in_progress_count,
      count(*) filter (where wc.status <> 'archived' and wc.service_status = 'waiting_customer') as waiting_count,
      count(*) filter (where wc.status <> 'archived' and wc.service_status = 'resolved') as resolved_count,
      count(*) filter (
        where wc.status <> 'archived'
          and wc.awaiting_response_since is not null
          and wc.service_status not in ('waiting_customer','resolved')
          and now() >= wc.awaiting_response_since + make_interval(
            mins => case wc.service_priority
              when 'low' then st.sla_low_minutes
              when 'high' then st.sla_high_minutes
              when 'urgent' then st.sla_urgent_minutes
              else st.sla_normal_minutes
            end
          )
      ) as overdue_count
    from public.whatsapp_conversations wc
    cross join settings st
    where wc.organization_id = p_organization_id
  ),
  totals as (
    select
      count(*) filter (where direction = 'inbound') as inbound_messages,
      count(*) filter (where direction = 'outbound') as outbound_messages,
      count(distinct conversation_id) as active_conversations,
      count(*) filter (where direction = 'inbound' and message_type <> 'text') as inbound_media,
      count(*) filter (where direction = 'outbound' and message_type <> 'text') as outbound_media
    from period_messages
  ),
  daily as (
    select jsonb_agg(
      jsonb_build_object(
        'date', d.day::date,
        'inbound', coalesce(m.inbound, 0),
        'outbound', coalesce(m.outbound, 0)
      )
      order by d.day
    ) as rows
    from generate_series(
      date_trunc('day', v_since),
      date_trunc('day', now()),
      interval '1 day'
    ) d(day)
    left join (
      select
        date_trunc('day', message_at) as day,
        count(*) filter (where direction = 'inbound') as inbound,
        count(*) filter (where direction = 'outbound') as outbound
      from period_messages
      group by 1
    ) m on m.day = d.day
  )
  select jsonb_build_object(
    'period_days', v_days,
    'since', v_since,
    'inbound_messages', t.inbound_messages,
    'outbound_messages', t.outbound_messages,
    'active_conversations', t.active_conversations,
    'inbound_media', t.inbound_media,
    'outbound_media', t.outbound_media,
    'avg_response_minutes', rs.avg_response_minutes,
    'answered_inbound', rs.answered_inbound,
    'new_count', q.new_count,
    'in_progress_count', q.in_progress_count,
    'waiting_count', q.waiting_count,
    'resolved_count', q.resolved_count,
    'overdue_count', q.overdue_count,
    'daily', coalesce(d.rows, '[]'::jsonb)
  )
  into v_result
  from totals t
  cross join response_stats rs
  cross join queue q
  cross join daily d;

  return v_result;
end;
$function$;

revoke all on function public.get_whatsapp_inbox_metrics(uuid, integer) from public;
grant execute on function public.get_whatsapp_inbox_metrics(uuid, integer) to authenticated;
