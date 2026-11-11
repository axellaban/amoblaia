-- Constructor de sitios web de las inmobiliarias (Panel → Sitio web).
-- Se puede re-ejecutar; solo agrega.
--
-- 1. agencies.site: el sitio armado en el editor. { draft, published,
--    publishedAt, updatedAt }. draft es lo que se edita (se guarda solo);
--    published es lo que ven los clientes en /inmobiliaria/<dirección>
--    cuando site_published está activo. Sin la columna, el sitio público
--    sigue mostrando el catálogo de siempre.
-- 2. Bucket público agency-site: las imágenes que la inmobiliaria sube para
--    su sitio (portada, nosotros, equipo, galería). Las escribe solo el
--    servidor (service role); se leen por su URL pública.
-- 3. site_inquiries: las consultas que llegan por los formularios del sitio
--    (contacto, tasación, consulta por una propiedad, newsletter). Solo el
--    servidor las lee y escribe.

alter table public.agencies add column if not exists site jsonb not null default '{}'::jsonb;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'agencies_site_size') then
    alter table public.agencies add constraint agencies_site_size check (octet_length(site::text) <= 900000);
  end if;
end $$;

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('agency-site', 'agency-site', true, 6291456, array['image/webp', 'image/jpeg', 'image/png'])
on conflict (id) do update
set public = true,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create table if not exists public.site_inquiries (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies(id) on delete cascade,
  kind text not null default 'contacto' check (kind in ('contacto', 'tasacion', 'propiedad', 'newsletter')),
  name text,
  email text,
  phone text,
  message text,
  property_token text,
  page text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  check (octet_length(coalesce(message, '')) <= 4000),
  check (octet_length(details::text) <= 4000)
);
create index if not exists site_inquiries_agency_idx on public.site_inquiries (agency_id, created_at desc);
alter table public.site_inquiries enable row level security;
-- Sin políticas: solo el servidor (service role) la lee y la escribe.
