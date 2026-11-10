alter table public.followup_state_catalog drop constraint followup_state_catalog_mapping,
  add constraint followup_state_catalog_mapping check (
    (source='product' and maps_to is null and product_stage is not null and
      ((commercial_stage='demo-enviada' and product_stage in ('no-abrio','sin-interaccion','sin-cuenta'))
      or (commercial_stage='interesado' and product_stage in ('sin-demo','sin-enviar'))))
    or (source<>'product' and product_stage is null and (not active or maps_to is not null))
  );

update public.followup_state_catalog
set source='product', product_stage='sin-demo', active=true, updated_at=now()
where commercial_stage='interesado' and lower(trim(label))='crear demo'
  and maps_to is null and product_stage is null and removed_at is null;
