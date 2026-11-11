-- Follow-up, Fase 2: bandeja de respuestas y seguimientos programados (docs/FOLLOWUP.md).
--
-- 1. Acciones nuevas: «seguimiento_2» (segundo paso de la secuencia de su etapa)
--    y «presentacion_seguimiento» (la presentación quedó sin respuesta). La
--    versión sigue siendo la variante del mensaje; la acción, el momento.
-- 2. followup_replies: cada respuesta de WhatsApp que registra la extensión (o
--    el equipo), con su texto original, la hora, la clasificación y la
--    confianza. Con confianza baja, un audio o una pregunta que el script no
--    cubre queda «facu» y no se manda nada hasta que alguien la resuelva.
--
-- Aditiva e idempotente. Solo la usan las rutas del servidor (service role).
begin;

alter table public.followup_versions drop constraint if exists followup_versions_action_check;
alter table public.followup_versions add constraint followup_versions_action_check
  check (action in ('principal', 'seguimiento_2', 'presentacion', 'presentacion_seguimiento', 'precios'));

create table if not exists public.followup_replies (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies(id) on delete cascade,
  body text not null check (length(btrim(body)) between 1 and 4000),
  received_at timestamptz not null,
  classification text check (classification in (
    'confirmo_numero', 'interesado', 'neutro', 'pregunta_precios', 'mas_adelante', 'derivo',
    'rechazo', 'proveedor_ia', 'no_contactar', 'audio', 'pregunta_no_cubierta')),
  confidence numeric(4, 3) check (confidence is null or confidence between 0 and 1),
  -- pendiente: sin clasificar; facu: la resuelve Facu; procesada: ya se aplicó su situación.
  status text not null default 'pendiente' check (status in ('pendiente', 'facu', 'procesada')),
  note text check (note is null or length(note) <= 500),
  -- La misma respuesta registrada dos veces (un reintento) no se duplica.
  client_key text not null unique check (length(client_key) between 8 and 200),
  recorded_by uuid references public.profiles(id) on delete set null,
  processed_by uuid references public.profiles(id) on delete set null,
  processed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists followup_replies_open on public.followup_replies (agency_id) where status <> 'procesada';

alter table public.followup_replies enable row level security;
revoke all on public.followup_replies from anon, authenticated;

commit;
