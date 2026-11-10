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
