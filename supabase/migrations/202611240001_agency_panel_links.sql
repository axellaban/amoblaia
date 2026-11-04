-- Enlace fijo de acceso al panel, uno por inmobiliaria (docs/ACCESO_PANEL.md).
--
-- /i/<inmobiliaria>-<codigo> abre el Inicio de su panel: iniciar sesión, crear
-- la cuenta o recorrerlo como invitado. A diferencia de las invitaciones de un
-- solo uso (agency_claims), este enlace no vence ni se consume: es siempre el
-- mismo hasta que el equipo lo cambia («Cambiar enlace»), y entonces el
-- anterior deja de funcionar al instante.
--
-- El código se guarda tal cual porque el equipo lo vuelve a copiar; solo lo
-- leen las rutas del servidor (service role): RLS sin políticas.
-- Aditiva e idempotente.
begin;

create table if not exists public.agency_panel_links (
  agency_id uuid primary key references public.agencies(id) on delete cascade,
  code text not null unique check (code ~ '^[2-9a-hjkmnp-z]{10}$'),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  rotated_at timestamptz
);

alter table public.agency_panel_links enable row level security;
revoke all on public.agency_panel_links from anon, authenticated;

commit;
