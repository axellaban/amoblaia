-- Habita Follow-up: configurable classifications (additive, non-destructive).
-- A custom conversational state is an alias of an existing canonical situation.
-- Until explicitly mapped, no new classification may drive automated outbound sends.
begin;

create table if not exists public.followup_state_catalog (
  key text primary key check (key ~ '^custom_[a-z0-9_]{3,60}$'),
  label text not null check (char_length(btrim(label)) between 2 and 80),
  description text not null default '' check (char_length(description) <= 800),
  examples text not null default '' check (char_length(examples) <= 2000),
  commercial_stage text not null check (commercial_stage in ('prospectado','contactado','interesado','demo-enviada','cuenta-creada','cuenta-activa')),
  source text not null default 'whatsapp' check (source in ('whatsapp','manual')),
  -- Canonical situation recognized by the existing follow-up engine. NULL = review only.
  maps_to text null check (maps_to in ('confirmo_numero','interesado','neutro','pregunta_precios','mas_adelante','derivo','rechazo','proveedor_ia','no_contactar')),
  active boolean not null default false,
  updated_by uuid null references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (not active or maps_to is not null)
);

create index if not exists followup_state_catalog_stage_idx
  on public.followup_state_catalog (commercial_stage, active);

alter table public.followup_state_catalog enable row level security;
revoke all on public.followup_state_catalog from anon, authenticated;

commit;
