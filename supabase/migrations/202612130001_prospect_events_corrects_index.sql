-- QA 2026-11-11 pm (OBS-012): /api/prospeccion y /api/metricas dan «statement
-- timeout» (57014) en ráfagas. habita_prospect_dataset, habita_prospect_derived_stage
-- y habita_prospect_replied preguntan por cada evento si hay una corrección
-- (`prospect_events.corrects_event_id = e.id`) y esa columna no tenía índice:
-- cada pregunta recorría la tabla entera (millones de seq scans acumulados).
-- Índice parcial, solo aditivo: no cambia datos ni funciones.
create index if not exists prospect_events_corrects
  on public.prospect_events (corrects_event_id)
  where corrects_event_id is not null;
