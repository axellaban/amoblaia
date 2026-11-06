-- Corrects the sheet events recorded by the old «Estado» parser (before
-- 202611280001_prospect_sheet_outcomes.sql):
-- * «Responde no interesado» matched /interesad/ and was recorded as an interest;
-- * «Esperando respuesta» matched /respuesta/ and was recorded as a reply.
-- An event is misparsed when the «Estado» its account had in the last import
-- before the event, read with the new exact list, does not justify it. Events
-- without a known «Estado» are left as they are.
-- prospect_events is append-only: each one gets a «correction» event
-- (corrects_event_id) through habita_prospect_record, which also recomputes
-- the stage. Nothing is deleted. Once corrected, the next sync records again,
-- with the right evidence, what the current «Estado» still justifies (e.g. an
-- account that is now «Demo enviada» gets its interest back).
-- Idempotent: the key of each correction is derived from the event, and an
-- event already corrected is skipped.
--
-- 1) Preview (read only): run the first statement and check the numbers.
-- 2) Apply: run the block below it, with the team's OK.

-- 1) PREVIEW ----------------------------------------------------------------
with norm(k, v) as (values
  ('pendiente', 'pending'), ('contactado', 'sent'), ('presentacion enviada', 'sent'), ('enviado', 'sent'), ('esperando respuesta', 'sent'),
  ('responde saludo inicial', 'replied'), ('respondio saludo', 'replied'), ('saludo respondido', 'replied'),
  ('neutro', 'neutral'), ('responde neutro', 'neutral'), ('interesado', 'interested'), ('responde interesado', 'interested'),
  ('demo enviada', 'interested'), ('no interesado', 'lost'), ('responde no interesado', 'lost'),
  ('no interesado - cuenta con proveedor de ia', 'lost'), ('sin whatsapp', 'invalid'), ('numero incorrecto', 'invalid')),
ev as (
 select e.id, e.account_id, e.type, e.actor,
  (select r.raw->>'Estado' from prospect_import_rows r join prospect_imports i on i.id=r.import_id
    where r.account_id=e.account_id and i.created_at <= e.recorded_at order by i.created_at desc limit 1) as estado
 from prospect_events e
 where e.source='import' and e.type in ('interest', 'reply') and coalesce((e.details->>'sheet')::boolean, false)
  and not exists (select 1 from prospect_events c where c.corrects_event_id=e.id)),
misparsed as (
 select ev.*, n.v as now_reads from ev left join norm n
  on n.k = btrim(regexp_replace(lower(translate(coalesce(ev.estado, ''), 'ÁÉÍÓÚÜáéíóúü–—', 'AEIOUUaeiouu--')), '\s+', ' ', 'g'))
 where ev.estado is not null and ((ev.type='interest' and coalesce(n.v, '') <> 'interested')
    or (ev.type='reply' and coalesce(n.v, '') not in ('replied', 'neutral', 'interested', 'lost'))))
select type, estado as estado_cuando_se_registro, count(*) as eventos, count(distinct account_id) as cuentas
from misparsed group by 1, 2 order by 1, 2;

-- 2) APPLY (with the team's OK) ----------------------------------------------
-- begin;
-- do $$
-- declare m record; n integer := 0;
-- begin
--  for m in
--   with norm(k, v) as (values
--     ('pendiente', 'pending'), ('contactado', 'sent'), ('presentacion enviada', 'sent'), ('enviado', 'sent'), ('esperando respuesta', 'sent'),
--     ('responde saludo inicial', 'replied'), ('respondio saludo', 'replied'), ('saludo respondido', 'replied'),
--     ('neutro', 'neutral'), ('responde neutro', 'neutral'), ('interesado', 'interested'), ('responde interesado', 'interested'),
--     ('demo enviada', 'interested'), ('no interesado', 'lost'), ('responde no interesado', 'lost'),
--     ('no interesado - cuenta con proveedor de ia', 'lost'), ('sin whatsapp', 'invalid'), ('numero incorrecto', 'invalid')),
--   ev as (
--    select e.id, e.account_id, e.type, e.actor,
--     (select r.raw->>'Estado' from prospect_import_rows r join prospect_imports i on i.id=r.import_id
--       where r.account_id=e.account_id and i.created_at <= e.recorded_at order by i.created_at desc limit 1) as estado
--    from prospect_events e
--    where e.source='import' and e.type in ('interest', 'reply') and coalesce((e.details->>'sheet')::boolean, false)
--     and not exists (select 1 from prospect_events c where c.corrects_event_id=e.id))
--   select ev.*, n.v as now_reads from ev left join norm n
--    on n.k = btrim(regexp_replace(lower(translate(coalesce(ev.estado, ''), 'ÁÉÍÓÚÜáéíóúü–—', 'AEIOUUaeiouu--')), '\s+', ' ', 'g'))
--   where ev.estado is not null and ((ev.type='interest' and coalesce(n.v, '') <> 'interested')
--      or (ev.type='reply' and coalesce(n.v, '') not in ('replied', 'neutral', 'interested', 'lost')))
--  loop
--   perform habita_prospect_record(m.actor, md5('fix-sheet-misparsed:' || m.id)::uuid, m.account_id, 'correction', now(), 'time',
--    null, null, null, 'Planilla: «' || coalesce(m.estado, '') || '» leído con el parser anterior',
--    jsonb_build_object('reason', 'Estado de la planilla mal leído (' || coalesce(m.estado, 'sin estado') || ')', 'sheet_fix', '202611280001'), m.id);
--   n := n + 1;
--  end loop;
--  raise notice '% eventos corregidos', n;
-- end $$;
-- commit;
