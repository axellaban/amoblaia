-- Music and watermark for the property videos. A private bucket for:
--  * library/<track>.<ext>: Habita's music library, generated once by the
--    team with fal (Administración → Música para videos);
--  * <agency>/<demo>/<uuid>.<ext>: the songs and logos an agency uploads to
--    use in its videos.
-- Only the server (service_role) signs uploads and links. Additive and idempotent.
begin;

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values (
  'video-media',
  'video-media',
  false,
  15728640,
  array['audio/mpeg', 'audio/mp3', 'audio/mp4', 'audio/x-m4a', 'audio/aac', 'audio/wav', 'audio/x-wav', 'image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

commit;
