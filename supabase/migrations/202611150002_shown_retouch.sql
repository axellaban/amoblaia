-- The retouch of a photo that the listing shows (one at a time, like a style's version).
-- Null: the listing shows no retouch. Deleting the retouch clears it.
alter table public.demo_photos
  add column if not exists shown_retouch_id uuid references public.photo_retouches(id) on delete set null;
