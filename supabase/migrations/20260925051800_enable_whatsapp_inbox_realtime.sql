
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname='supabase_realtime'
      and schemaname='public'
      and tablename='whatsapp_conversation_notes'
  ) then
    alter publication supabase_realtime add table public.whatsapp_conversation_notes;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname='supabase_realtime'
      and schemaname='public'
      and tablename='whatsapp_tags'
  ) then
    alter publication supabase_realtime add table public.whatsapp_tags;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname='supabase_realtime'
      and schemaname='public'
      and tablename='whatsapp_conversation_tags'
  ) then
    alter publication supabase_realtime add table public.whatsapp_conversation_tags;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname='supabase_realtime'
      and schemaname='public'
      and tablename='whatsapp_inbox_settings'
  ) then
    alter publication supabase_realtime add table public.whatsapp_inbox_settings;
  end if;
end $$;
