-- QA 2026-11-12 am (OBS-011): `lead_recompute_failed` en POST /api/demo/<token>/leads,
-- repetido varios días. Supabase devuelve 409 (23505, clave primaria duplicada) en
-- habita_lead_replace_scores cuando llegan dos lotes de la misma demo a la vez:
-- los dos borran las filas de la demo, el primero inserta y confirma, y el segundo,
-- que ya no ve esas filas nuevas en su borrado, inserta las mismas claves y choca.
-- El puntaje de ese visitante queda sin el último lote hasta el siguiente.
-- Arreglo: un candado transaccional por demo al empezar, así los recálculos de la
-- misma demo van uno detrás del otro. Mismo cuerpo que 202611140001, más el candado;
-- no cambia datos ni otras funciones.
create or replace function public.habita_lead_replace_scores(p_demo uuid, p_rows jsonb) returns integer language plpgsql security definer set search_path=public as $$
declare stored integer;
begin
 if jsonb_typeof(p_rows) <> 'array' then raise exception 'INVALID_LEAD_SCORES'; end if;
 perform pg_advisory_xact_lock(hashtextextended('habita_lead_replace_scores:' || p_demo::text, 0));
 delete from lead_visitor_scores where demo_id = p_demo;
 insert into lead_visitor_scores(demo_id,visitor_id,agency_id,score,classification,score_version,visual_score,depth_score,commercial_score,
  activation_score,recurrence_score,score_breakdown,explanation,signals,aliases,sessions,events,calculated_at,first_event_at,last_event_at,
  last_qualifying_event_at,attribution_confidence,visitor_type,is_internal,internal_reasons,score_data_quality)
 select p_demo,r.visitor_id,r.agency_id,r.score,r.classification,r.score_version,coalesce(r.visual_score,0),coalesce(r.depth_score,0),
  coalesce(r.commercial_score,0),coalesce(r.activation_score,0),coalesce(r.recurrence_score,0),coalesce(r.score_breakdown,'{}'::jsonb),coalesce(r.explanation,''),coalesce(r.signals,'{}'),
  coalesce(r.aliases,'{}'),coalesce(r.sessions,'{}'),coalesce(r.events,0),now(),r.first_event_at,r.last_event_at,r.last_qualifying_event_at,
  coalesce(r.attribution_confidence,'anonymous'),coalesce(r.visitor_type,'unknown'),coalesce(r.is_internal,false),coalesce(r.internal_reasons,'{}'),
  coalesce(r.score_data_quality,'complete')
 from jsonb_to_recordset(p_rows) as r(visitor_id text,agency_id uuid,score smallint,classification text,score_version text,visual_score smallint,
  depth_score smallint,commercial_score smallint,activation_score smallint,recurrence_score smallint,score_breakdown jsonb,explanation text,
  signals text[],aliases text[],sessions text[],events integer,first_event_at timestamptz,last_event_at timestamptz,
  last_qualifying_event_at timestamptz,attribution_confidence text,visitor_type text,is_internal boolean,internal_reasons text[],score_data_quality text);
 get diagnostics stored = row_count;
 return stored;
end $$;
revoke all on function public.habita_lead_replace_scores(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.habita_lead_replace_scores(uuid, jsonb) to service_role;
