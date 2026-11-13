-- Follow-up: situaciones de avance dentro de la regla (docs/FOLLOWUP.md, «Avance y respuesta»).
--
-- Una regla corría en una sola subetapa del embudo (`stage`). Ahora lleva la
-- lista de subetapas en las que corre (`product_stages`), todas de la misma
-- etapa comercial; `stage` queda como ancla: donde vive su mensaje. Así
-- «Precios» o «No interesado» son una regla por etapa y no una por subetapa.
-- Aditiva e idempotente: cada regla queda corriendo donde corría.
begin;

alter table public.followup_rules add column if not exists product_stages text[] not null default '{}';
alter table public.followup_rules drop constraint if exists followup_rules_product_stages_check;
alter table public.followup_rules add constraint followup_rules_product_stages_check
  check (product_stages <@ array['no-contactado','no-responde','sin-demo','sin-enviar','no-abrio','sin-interaccion','sin-cuenta','sin-uso','sin-suscripcion']);

update public.followup_rules set product_stages = array[stage] where product_stages = '{}';

-- Un estado de producto del catálogo decía lo mismo que la subetapa de la regla: sobra.
update public.followup_rules r set catalog_situation = null
  from public.followup_state_catalog c
  where c.key = r.catalog_situation and c.source = 'product' and c.product_stage = r.stage;

commit;
