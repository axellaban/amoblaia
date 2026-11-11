alter table public.followup_state_catalog
  add column product_stage text,
  drop constraint followup_state_catalog_check,
  drop constraint followup_state_catalog_source_check,
  add constraint followup_state_catalog_source_check check (source in ('whatsapp','manual','product')),
  add constraint followup_state_catalog_mapping check (
    (source='product' and commercial_stage='demo-enviada' and product_stage is not null
      and product_stage in ('no-abrio','sin-interaccion','sin-cuenta') and maps_to is null)
    or (source<>'product' and product_stage is null and (not active or maps_to is not null))
  );
update public.followup_state_catalog as s
set source='product', product_stage=m.stage,active=true,updated_at=now()
from (values ('No visitó','no-abrio'),('Visitó sin interactuar','sin-interaccion'),('Interactuó','sin-cuenta')) as m(label,stage)
where s.label=m.label and s.commercial_stage='demo-enviada' and s.maps_to is null and s.removed_at is null;
