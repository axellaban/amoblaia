-- Reclasificación histórica del tráfico interno (auditoría de PostHog del 03/11/2026).
-- Ver docs/TRAFICO_INTERNO.md § Datos históricos.
--
-- Solo agrega dispositivos al registro (internal_devices, origen 'backfill'):
-- no borra ni modifica ningún evento. Rehace el resumen derivado de actividad
-- de cada demo (activity_*); los lead scores se rehacen con «Recalcular todo»
-- en /admin/internos (los calcula la aplicación).
--
-- * 12 con evidencia propia: marcados is_internal en PostHog en algún momento,
--   o con uso del panel del equipo (/admin) desde la red del equipo.
-- * 44 vistos solo desde la red (IP) del equipo. La IP sola no alcanza para
--   atribuirlos automáticamente; el equipo revisó la lista y los confirmó como
--   propios (decisión del 03/11/2026). Si alguno resultara de un cliente, se
--   corrige en /admin/internos («Es un cliente») y vuelve a contar.
-- Todos quedan con status 'internal' y la evidencia de cada uno.
-- Re-ejecutable: un dispositivo ya registrado no se duplica ni cambia de estado.
begin;

insert into public.internal_devices(status, source, ph_device_ids, label, evidence, first_seen_at, last_seen_at, status_reason)
select v.status, 'backfill', array[v.device], 'Histórico ' || left(v.device, 8), v.evidence, now(), now(), 'auditoria_2026_11_03'
from (values
 ('internal', '01a17a95-4e85-7a2a-902c-8647bed04072', 'Windows · Chrome. Marcado is_internal en PostHog; 2138 vistas del admin.'),
 ('internal', '01a17a85-1c2b-769e-8827-f813162e6c22', 'Windows · Chrome. Marcado is_internal en PostHog; 1403 vistas del admin.'),
 ('internal', '01a19c6d-5564-79c4-8267-02d7b058c201', 'Windows · Chrome. Marcado is_internal en PostHog; 706 vistas del admin.'),
 ('internal', '01a18984-860b-733b-83cd-3a9aef938bd4', 'Windows · Chrome. Marcado is_internal en PostHog; 689 vistas del admin.'),
 ('internal', '01a1a204-30fb-7ebc-a273-6ad45991b8d6', 'Windows · Chrome. Marcado is_internal en PostHog; 631 vistas del admin.'),
 ('internal', '01a17a8e-0b55-7144-aaab-477c737637ba', 'iPhone. Marcado is_internal en PostHog; 154 vistas del admin; 399 eventos posteriores sin marca.'),
 ('internal', '01a19cf1-cfd9-763c-954c-9b5cd98ea768', 'iPhone · Safari. Marcado is_internal en PostHog; 15 vistas del admin.'),
 ('internal', '01a199a5-d167-70cb-a41a-b49123e5b092', 'Windows · Chrome. Marcado is_internal en PostHog; 9 vistas del admin.'),
 ('internal', '01a16fbc-616a-7399-a44a-53b8d28a39f1', 'Windows · Chrome, 24–26/10 (antes de la marca). 870 vistas del admin desde la red del equipo.'),
 ('internal', '01a17680-f9ee-7614-b8bd-c8b70f424b9c', 'iPhone · Safari, 26/10 (antes de la marca). Vistas del admin desde la red del equipo.'),
 ('internal', '01a17008-a0a9-763b-ab6e-77e56d0ef2eb', 'iPhone · Chrome, 24–26/10 (antes de la marca). Vistas del admin desde la red del equipo.'),
 ('internal', '01a18885-a89c-7361-b71d-b32173e5eb10', 'Windows · Chrome, 29/10. Vistas del admin desde la red del equipo.'),
 ('internal', '01a199d2-2efc-7462-bee3-6155ec28659a', 'Visto solo desde la red del equipo; el equipo lo confirmó como propio el 03/11. 20 aperturas de demo.'),
 ('internal', '01a188dd-ea89-7151-8e8e-2eaf906ca9f4', 'Visto solo desde la red del equipo; el equipo lo confirmó como propio el 03/11. 11 aperturas de demo.'),
 ('internal', '01a16b4d-3194-7984-9eee-60951511fde7', 'Visto solo desde la red del equipo; el equipo lo confirmó como propio el 03/11. 10 aperturas de demo.'),
 ('internal', '01a19cf6-fe11-752e-85b9-14cd7dea8398', 'Visto solo desde la red del equipo; el equipo lo confirmó como propio el 03/11. 9 aperturas de demo.'),
 ('internal', '01a188cb-715f-77f3-8341-9c79b2554a8a', 'Visto solo desde la red del equipo; el equipo lo confirmó como propio el 03/11. 6 aperturas de demo.'),
 ('internal', '01a188ce-b842-7a25-96fd-9ee03d3277c7', 'Visto solo desde la red del equipo; el equipo lo confirmó como propio el 03/11. 2 aperturas de demo.'),
 ('internal', '01a18ea0-e033-75b8-9eed-11810e97adee', 'Visto solo desde la red del equipo; el equipo lo confirmó como propio el 03/11. 2 aperturas de demo.'),
 ('internal', '01a1889b-a558-7bfe-b843-84767ce1ed5e', 'Visto solo desde la red del equipo; el equipo lo confirmó como propio el 03/11. 2 aperturas de demo.'),
 ('internal', '01a1a35c-ddca-77df-8212-d24048563d46', 'Visto solo desde la red del equipo; el equipo lo confirmó como propio el 03/11. 2 aperturas de demo.'),
 ('internal', '01a188ed-f2db-7e63-b7d7-89789fff7061', 'Visto solo desde la red del equipo; el equipo lo confirmó como propio el 03/11. 2 aperturas de demo.'),
 ('internal', '01a1a3d7-b919-715c-aac7-cd64b504b680', 'Visto solo desde la red del equipo; el equipo lo confirmó como propio el 03/11. 1 aperturas de demo.'),
 ('internal', '01a18937-0789-7272-bc74-b11f81c3924c', 'Visto solo desde la red del equipo; el equipo lo confirmó como propio el 03/11. 1 aperturas de demo.'),
 ('internal', '01a1a3d3-6575-7ba9-8202-f8e34eaf60e7', 'Visto solo desde la red del equipo; el equipo lo confirmó como propio el 03/11. 1 aperturas de demo.'),
 ('internal', '01a188c2-76ea-7be4-8167-91436040de42', 'Visto solo desde la red del equipo; el equipo lo confirmó como propio el 03/11. 1 aperturas de demo.'),
 ('internal', '01a19ee5-44b4-754a-83b9-0b8d3a324d33', 'Visto solo desde la red del equipo; el equipo lo confirmó como propio el 03/11. 1 aperturas de demo.'),
 ('internal', '01a1889f-e345-72c4-803f-0f3de9a1d198', 'Visto solo desde la red del equipo; el equipo lo confirmó como propio el 03/11. 1 aperturas de demo.'),
 ('internal', '01a17929-596b-7e65-8c91-47e9d2df15bc', 'Visto solo desde la red del equipo; el equipo lo confirmó como propio el 03/11. 1 aperturas de demo.'),
 ('internal', '01a1a2cd-b934-7e72-aa33-fd2d808ec262', 'Visto solo desde la red del equipo; el equipo lo confirmó como propio el 03/11. 1 aperturas de demo.'),
 ('internal', '01a199ac-0571-744f-b11d-4cbd2baa2d63', 'Visto solo desde la red del equipo; el equipo lo confirmó como propio el 03/11. 1 aperturas de demo.'),
 ('internal', '01a18dc2-84c0-7a60-84b0-78e3ca5761d3', 'Visto solo desde la red del equipo; el equipo lo confirmó como propio el 03/11. 1 aperturas de demo.'),
 ('internal', '01a19f81-35e7-7ac7-af01-aa528c50b1fc', 'Visto solo desde la red del equipo; el equipo lo confirmó como propio el 03/11. 1 aperturas de demo.'),
 ('internal', '01a19dc2-4d02-7f2c-add1-263ea9e3e401', 'Visto solo desde la red del equipo; el equipo lo confirmó como propio el 03/11. 1 aperturas de demo.'),
 ('internal', '01a1a18c-1637-7258-a406-aa9927a50bdb', 'Visto solo desde la red del equipo; el equipo lo confirmó como propio el 03/11. 1 aperturas de demo.'),
 ('internal', '01a19ce3-ec2c-79e0-9801-5c1cef201663', 'Visto solo desde la red del equipo; el equipo lo confirmó como propio el 03/11. 1 aperturas de demo.'),
 ('internal', '01a1a38b-1640-76ee-a75d-2dfa23cda1e3', 'Visto solo desde la red del equipo; el equipo lo confirmó como propio el 03/11. 1 aperturas de demo.'),
 ('internal', '01a1957d-7e7b-79fe-9f48-c9373ec09730', 'Visto solo desde la red del equipo; el equipo lo confirmó como propio el 03/11. 0 aperturas de demo.'),
 ('internal', '01a17928-91b9-7300-94ac-ac57495ddca5', 'Visto solo desde la red del equipo; el equipo lo confirmó como propio el 03/11. 0 aperturas de demo.'),
 ('internal', '01a18fb4-7368-7886-a231-635435178ffc', 'Visto solo desde la red del equipo; el equipo lo confirmó como propio el 03/11. 0 aperturas de demo.'),
 ('internal', '01a189d3-511d-7130-a2c4-cc6e7580213d', 'Visto solo desde la red del equipo; el equipo lo confirmó como propio el 03/11. 0 aperturas de demo.'),
 ('internal', '01a18da9-883c-7293-93e7-be6b9b3256db', 'Visto solo desde la red del equipo; el equipo lo confirmó como propio el 03/11. 0 aperturas de demo.'),
 ('internal', '01a189e9-5059-7265-9b5d-2676c542d00d', 'Visto solo desde la red del equipo; el equipo lo confirmó como propio el 03/11. 0 aperturas de demo.'),
 ('internal', '01a1a3c3-a7d9-7ea1-892c-4e0f58cd6205', 'Visto solo desde la red del equipo; el equipo lo confirmó como propio el 03/11. 0 aperturas de demo.'),
 ('internal', '01a199bf-a560-7348-a36e-62dc43c211f5', 'Visto solo desde la red del equipo; el equipo lo confirmó como propio el 03/11. 0 aperturas de demo.'),
 ('internal', '01a19770-14e3-7299-873b-b7b752837ff8', 'Visto solo desde la red del equipo; el equipo lo confirmó como propio el 03/11. 0 aperturas de demo.'),
 ('internal', '01a17dce-2440-768c-a875-aafb60e3f9a3', 'Visto solo desde la red del equipo; el equipo lo confirmó como propio el 03/11. 0 aperturas de demo.'),
 ('internal', '01a193d2-82c1-7e51-aa69-c6573af52fb8', 'Visto solo desde la red del equipo; el equipo lo confirmó como propio el 03/11. 0 aperturas de demo.'),
 ('internal', '01a19cb7-57ff-7e6b-bbc0-5c9973f364ab', 'Visto solo desde la red del equipo; el equipo lo confirmó como propio el 03/11. 0 aperturas de demo.'),
 ('internal', '01a169f2-ee2c-7d1b-828c-6f7f1d3eb74d', 'Visto solo desde la red del equipo; el equipo lo confirmó como propio el 03/11. 0 aperturas de demo.'),
 ('internal', '01a1899c-528c-719f-8934-e962898bba11', 'Visto solo desde la red del equipo; el equipo lo confirmó como propio el 03/11. 0 aperturas de demo.'),
 ('internal', '01a169a1-0c60-7ff4-912e-f9de4c617397', 'Visto solo desde la red del equipo; el equipo lo confirmó como propio el 03/11. 0 aperturas de demo.'),
 ('internal', '01a19394-36f7-76d6-99a5-5fb06bb8298d', 'Visto solo desde la red del equipo; el equipo lo confirmó como propio el 03/11. 0 aperturas de demo.'),
 ('internal', '01a18d6a-5635-79e0-b7e7-4dff739734c3', 'Visto solo desde la red del equipo; el equipo lo confirmó como propio el 03/11. 0 aperturas de demo.'),
 ('internal', '01a18a12-8534-786a-8837-89ac0fcdb0d8', 'Visto solo desde la red del equipo; el equipo lo confirmó como propio el 03/11. 0 aperturas de demo.'),
 ('internal', '01a18e4b-6d3c-7745-bf90-ae3c69e54b60', 'Visto solo desde la red del equipo; el equipo lo confirmó como propio el 03/11. 0 aperturas de demo.')
) as v(status, device, evidence)
where not exists (select 1 from public.internal_devices d where v.device = any(d.ph_device_ids));

-- The demos' visit summary (derived columns only) rebuilt from the commercial activity.
select public.habita_recompute_demo_activity(null);

commit;
