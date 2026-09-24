
create or replace function private.refresh_whatsapp_conversation_state()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  update public.whatsapp_conversations
     set last_message_at = coalesce(new.sent_at, new.created_at),
         last_message_preview = case
           when new.message_type = 'text' then left(coalesce(new.body,''), 240)
           when new.message_type = 'image' then '📷 Imagem'
           when new.message_type = 'audio' then '🎵 Áudio'
           when new.message_type = 'video' then '🎥 Vídeo'
           when new.message_type = 'document' then '📄 Documento'
           when new.message_type = 'sticker' then '🏷️ Figurinha'
           when new.message_type = 'location' then '📍 Localização'
           when new.message_type = 'contact' then '👤 Contato'
           else '[' || coalesce(new.message_type,'mensagem') || ']'
         end,
         unread_count = case
           when new.direction = 'inbound' then unread_count + 1
           else unread_count
         end,
         updated_at = now()
   where id = new.conversation_id
     and organization_id = new.organization_id;
  return new;
end;
$function$;
