create table public.followup_commercial_stages (
  key text primary key,
  label text not null check (length(trim(label)) between 2 and 80),
  technical_stage text,
  entry_situation text,
  created_at timestamptz not null default now(),
  unique (technical_stage, entry_situation),
  check ((technical_stage is null) = (entry_situation is null)),
  check (technical_stage in ('no-contactado','no-responde','sin-demo','sin-enviar','no-abrio','sin-interaccion','sin-cuenta','sin-uso','sin-suscripcion')),
  check (entry_situation in ('sin_respuesta','confirmo_numero','interesado','neutro','pregunta_precios','mas_adelante','derivo','rechazo','proveedor_ia','no_contactar','sin_whatsapp','numero_incorrecto'))
);
create unique index followup_stage_name on public.followup_commercial_stages(lower(trim(label)));
alter table public.followup_commercial_stages enable row level security;
revoke all on public.followup_commercial_stages from public, anon, authenticated;
grant select, insert on public.followup_commercial_stages to service_role;
insert into public.followup_commercial_stages(key,label) values
('prospectado','Prospectado'),('contactado','Contactado'),('interesado','Interesado'),('demo-enviada','Demo enviada'),
('cuenta-creada','Cuenta creada'),('cuenta-activa','Cuenta activa'),('cliente','Cliente');
alter table public.followup_state_catalog drop constraint followup_state_catalog_commercial_stage_check,
  add constraint followup_state_stage_fk foreign key(commercial_stage) references public.followup_commercial_stages(key);
