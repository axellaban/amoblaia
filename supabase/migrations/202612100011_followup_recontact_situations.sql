-- Two distinct temporary recontact classifications. Keep all previous allowed
-- values; add only the new labels and do not alter existing records.
set lock_timeout = '5s';
alter table public.followup_agencies
  drop constraint if exists followup_agencies_situation_check;
alter table public.followup_agencies
  add constraint followup_agencies_situation_check check (situation in (
    'sin_respuesta','confirmo_numero','interesado','neutro','pregunta_precios',
    'mas_adelante','recontactar_vacaciones','recontactar_mas_adelante','derivo',
    'rechazo','proveedor_ia','no_contactar','sin_whatsapp','numero_incorrecto'
  ));

alter table public.followup_commercial_stages
  drop constraint if exists followup_commercial_stages_entry_situation_check;
alter table public.followup_commercial_stages
  add constraint followup_commercial_stages_entry_situation_check check (entry_situation in (
    'sin_respuesta','confirmo_numero','interesado','neutro','pregunta_precios','mas_adelante',
    'recontactar_vacaciones','recontactar_mas_adelante','derivo',
    'rechazo','proveedor_ia','no_contactar','sin_whatsapp','numero_incorrecto'
  ));
alter table public.followup_stage_situation_overrides
  drop constraint if exists followup_stage_situation_overrides_key_check;
alter table public.followup_stage_situation_overrides
  add constraint followup_stage_situation_overrides_key_check check (key in (
    'sin_respuesta','confirmo_numero','interesado','neutro','pregunta_precios','mas_adelante',
    'recontactar_vacaciones','recontactar_mas_adelante','derivo',
    'rechazo','proveedor_ia','no_contactar','sin_whatsapp','numero_incorrecto'
  ));
alter table public.followup_rules
  drop constraint if exists followup_rules_situations_check;
alter table public.followup_rules
  add constraint followup_rules_situations_check check (situations <@ array[
    'sin_respuesta','confirmo_numero','interesado','neutro','pregunta_precios','mas_adelante',
    'recontactar_vacaciones','recontactar_mas_adelante','derivo','rechazo']::text[]);
alter table public.followup_state_catalog
  drop constraint if exists followup_state_catalog_maps_to_check;
alter table public.followup_state_catalog
  add constraint followup_state_catalog_maps_to_check check (maps_to in (
    'confirmo_numero','interesado','neutro','pregunta_precios','mas_adelante',
    'recontactar_vacaciones','recontactar_mas_adelante','derivo',
    'rechazo','proveedor_ia','no_contactar'
  ));
