-- Prospectos: lo que habita. deja listo para «Crear demo».
-- listing_checks: la lectura de prueba de cada aviso (el principal y las dos precargas), por URL:
--   { "<url>": { ok, photos, title, error, at } }. Se hace al guardarlos y no crea nada.
-- demo_prep: cuando la inmobiliaria pasa a Interesado, las tres publicaciones importadas a su panel
--   («Lista para importar»): { at, attempts, items: [{ key, url, ok, demoId, photos, error }] }.
-- Solo el servidor (service_role) las lee y escribe, como el resto de prospect_profiles. Se puede re-ejecutar.
begin;
alter table public.prospect_profiles
  add column if not exists listing_checks jsonb not null default '{}'::jsonb,
  add column if not exists demo_prep jsonb;
commit;
