alter table public.followup_state_catalog drop constraint followup_state_catalog_mapping,
  add constraint followup_state_catalog_mapping check (
    (source='product' and maps_to is null and product_stage is not null and
      (commercial_stage,product_stage) in (
        ('prospectado','no-contactado'),('contactado','no-responde'),('interesado','sin-demo'),('interesado','sin-enviar'),
        ('demo-enviada','no-abrio'),('demo-enviada','sin-interaccion'),('demo-enviada','sin-cuenta'),
        ('cuenta-creada','sin-uso'),('cuenta-activa','sin-suscripcion')))
    or (source<>'product' and product_stage is null and (not active or maps_to is not null))
  );

insert into public.followup_state_catalog(key,label,commercial_stage,source,product_stage,active,description)
values ('custom_cuenta_creada_sin_interaccion','Cuenta creada sin interacción','cuenta-creada','product','sin-uso',true,
        'Creó su cuenta y todavía no registró uso en el panel.')
on conflict (key) do nothing;

update public.followup_rules set catalog_situation='custom_cuenta_creada_sin_interaccion', updated_at=now()
where stage='sin-uso' and action='principal' and name='Recordatorio créditos panel'
  and catalog_situation is null and cardinality(situations)=0;
