-- Retouches of a demo photo: light and colour adjustments saved as a version.
-- They are free and do not count toward the photo's AI versions or credits.
-- The source is the original photo, an AI version (generations) or another retouch.
create table if not exists public.photo_retouches (
  id uuid primary key default gen_random_uuid(),
  photo_id uuid not null references public.demo_photos(id) on delete cascade,
  source_generation_id uuid references public.generations(id) on delete set null,
  source_retouch_id uuid references public.photo_retouches(id) on delete set null,
  adjust jsonb not null,
  result_path text not null,
  result_bytes integer,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists photo_retouches_photo on public.photo_retouches(photo_id, created_at);
alter table public.photo_retouches enable row level security;
