alter table public.followup_state_catalog add column removed_at timestamptz;

create table public.followup_stage_situation_overrides (
  commercial_stage text not null references public.followup_commercial_stages(key),
  key text not null check (key in ('sin_respuesta','confirmo_numero','interesado','neutro','pregunta_precios','mas_adelante','derivo','rechazo','proveedor_ia','no_contactar','sin_whatsapp','numero_incorrecto')),
  label text not null check (length(btrim(label)) between 2 and 80),
  description text not null default '' check (length(description) <= 800),
  examples text not null default '' check (length(examples) <= 2000),
  removed boolean not null default false,
  primary key (commercial_stage,key)
);
alter table public.followup_stage_situation_overrides enable row level security;
revoke all on public.followup_stage_situation_overrides from public, anon, authenticated;
grant select, insert, update on public.followup_stage_situation_overrides to service_role;
