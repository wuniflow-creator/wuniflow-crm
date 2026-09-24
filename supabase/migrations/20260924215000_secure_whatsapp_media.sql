do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'wa media insert org members'
  ) then
    create policy "wa media insert org members"
    on storage.objects
    for insert
    to authenticated
    with check (
      bucket_id = 'whatsapp-media'
      and (storage.foldername(name))[3] = 'outbound'
      and exists (
        select 1
        from public.whatsapp_conversations wc
        join public.organization_members om
          on om.organization_id = wc.organization_id
        where wc.id::text = (storage.foldername(name))[2]
          and wc.organization_id::text = (storage.foldername(name))[1]
          and om.user_id = auth.uid()
          and om.is_active = true
      )
    );
  end if;
end
$$;

update storage.buckets
set public = false,
    file_size_limit = 26214400,
    allowed_mime_types = array[
      'image/jpeg',
      'image/png',
      'image/webp',
      'audio/ogg',
      'audio/mpeg',
      'audio/mp4',
      'audio/webm',
      'video/mp4',
      'application/pdf',
      'application/octet-stream',
      'text/plain',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    ]::text[]
where id = 'whatsapp-media';
