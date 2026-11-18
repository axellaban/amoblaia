-- Fotos ya recomprimidas (sin staging: 1600 px y JPEG fuerte; staging: mismo tamaño, JPEG cuidado).
-- Una fila por archivo, para no volver a recomprimir lo que ya se procesó.
create table if not exists public.image_compactions (
  path text primary key,
  kind text not null check (kind in ('original','staging')),
  before_bytes integer not null,
  after_bytes integer not null,
  replaced boolean not null,
  at timestamptz not null default now()
);
alter table public.image_compactions enable row level security;
revoke all on public.image_compactions from anon, authenticated;
