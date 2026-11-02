-- Crear video: four export formats (9:16, 16:9, 4:5, 1:1), each its own MP4,
-- and how each video was made (photos in order, AI stagings on or off, the
-- information it carries) so another format can be exported later from the
-- same photos. Additive and idempotent; existing videos keep their values.
begin;

alter table public.property_videos drop constraint if exists property_videos_format_check;
alter table public.property_videos
  add constraint property_videos_format_check check (format in ('9:16', '16:9', '4:5', '1:1'));

alter table public.property_videos add column if not exists width integer check (width is null or width between 1 and 4096);
alter table public.property_videos add column if not exists height integer check (height is null or height between 1 and 4096);
alter table public.property_videos add column if not exists options jsonb not null default '{}'::jsonb;

update public.property_videos set width = 1080, height = 1920 where width is null and format = '9:16';
update public.property_videos set width = 1920, height = 1080 where width is null and format = '16:9';

commit;
