-- Follow-up: una regla de «Precios» y una de «No interesado» por etapa comercial
-- (docs/FOLLOWUP.md, «Avance y respuesta»). Va después de 202612160001 y del
-- deploy que entiende `product_stages`.
--
-- En «Interesado» y «Demo enviada» esas dos reglas existían una vez por
-- subetapa, con el mismo mensaje. Queda una, que corre en todas las subetapas
-- de su etapa; las otras se borran (quedan en la auditoría). Solo junta reglas
-- gemelas: misma acción, mismas respuestas, espera, horario y estado, y el
-- mismo texto activo. Las versiones y las ejecuciones no se tocan. Idempotente.
begin;

with stage_group(stage, commercial, ord) as (values
  ('sin-demo', 'interesado', 1), ('sin-enviar', 'interesado', 2),
  ('no-abrio', 'demo-enviada', 1), ('sin-interaccion', 'demo-enviada', 2), ('sin-cuenta', 'demo-enviada', 3)
), twins as (
  select r.key, r.stage, r.action, g.commercial, r.position,
         md5(coalesce((select v.body from public.followup_versions v where v.stage = r.stage and v.action = r.action and v.status = 'active'), '')) as body,
         r.situations, r.after_hours, r.after_action, r.enabled, r.hours_from, r.hours_to, r.days, r.min_demo_activity_level
    from public.followup_rules r join stage_group g on g.stage = r.stage
   where r.action in ('precios', 'encuesta_cierre') and r.catalog_situation is null and r.product_stages = array[r.stage]
), ranked as (
  select t.*,
         first_value(t.key) over w as keeper,
         count(*) over (partition by t.commercial, t.action, t.body, t.situations, t.after_hours, t.after_action, t.enabled, t.hours_from, t.hours_to, t.days, t.min_demo_activity_level) as n,
         array_agg(t.stage) over (partition by t.commercial, t.action, t.body, t.situations, t.after_hours, t.after_action, t.enabled, t.hours_from, t.hours_to, t.days, t.min_demo_activity_level) as stages
    from twins t
  window w as (partition by t.commercial, t.action, t.body, t.situations, t.after_hours, t.after_action, t.enabled, t.hours_from, t.hours_to, t.days, t.min_demo_activity_level order by t.position, t.key)
), grown as (
  update public.followup_rules r
     set product_stages = (select array_agg(g.stage order by g.ord) from stage_group g where g.stage = any(k.stages)), updated_at = now()
    from ranked k where k.n > 1 and k.key = k.keeper and r.key = k.key
  returning r.key
), logged as (
  insert into public.followup_audit (subject, ref, old_value, new_value, actor_name)
  select 'rule', k.key, left(to_jsonb(r)::text, 2000), null, 'Migración 202612160002'
    from ranked k join public.followup_rules r on r.key = k.key where k.n > 1 and k.key <> k.keeper
  returning ref
)
delete from public.followup_rules r using ranked k where k.n > 1 and k.key <> k.keeper and r.key = k.key;

commit;
