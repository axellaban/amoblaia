-- Prospectos: la base de inmobiliarias antes de entrar a la cola de Follow-up.
--
-- Cada cuenta de prospección puede tener un perfil: las variables que se van
-- relevando (cartera, necesidad visual, madurez digital…), su estado antes de
-- la cola, su ranking y la foto de esas variables el día que entró a la cola,
-- para comparar después contra lo que pasó.
--
-- Una cuenta SIN perfil sigue como hasta ahora (entra a la cola con las reglas
-- de siempre), así que aplicar esta migración no cambia la operación.
-- Aditiva e idempotente: se puede volver a ejecutar.

create table if not exists public.prospect_profiles (
 account_id uuid primary key references public.prospect_accounts(id) on delete cascade,
 status text not null default 'descubierto' check (status in ('descubierto', 'enriquecido', 'calificado', 'en_cola', 'descartado')),
 discard_reason text check (discard_reason is null or length(discard_reason) <= 300),
 profile jsonb not null default '{}' check (jsonb_typeof(profile) = 'object'),
 score numeric(6,2) check (score is null or (score >= 0 and score <= 100)),
 score_components jsonb not null default '{}' check (jsonb_typeof(score_components) = 'object'),
 scoring_version text check (scoring_version is null or length(scoring_version) <= 80),
 explore boolean not null default false,
 queued_at timestamptz,
 queue_snapshot jsonb,
 updated_by uuid,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index if not exists prospect_profiles_status on public.prospect_profiles(status);
alter table public.prospect_profiles enable row level security;
revoke all on public.prospect_profiles from public, anon, authenticated;

-- Guarda el perfil de una cuenta. `p_patch` puede traer:
--   profile           objeto con las variables a cambiar (null borra la variable)
--   status            estado antes de la cola
--   discard_reason    motivo, obligatorio al descartar
--   score, score_components, scoring_version   el ranking calculado por el servidor
--   explore           entra a la cola por el cupo de exploración
--   snapshot          la foto de variables y ranking: con ella «en_cola» cuenta como una entrada nueva a la cola
-- El cambio de estado queda en el historial de la cuenta.
create or replace function public.habita_prospect_pool_save(p_actor uuid, p_account uuid, p_patch jsonb)
 returns jsonb language plpgsql security definer set search_path=public as $$
declare a prospect_profiles; b prospect_profiles; k text; merged jsonb; st text;
 allowed constant text[] := array['profile', 'status', 'discard_reason', 'score', 'score_components', 'scoring_version', 'explore', 'snapshot'];
begin
 if jsonb_typeof(p_patch) is distinct from 'object' then raise exception 'INVALID_FIELD:patch'; end if;
 for k in select jsonb_object_keys(p_patch) loop
  if not k = any(allowed) then raise exception 'INVALID_FIELD:%', k; end if;
 end loop;
 if not exists (select 1 from prospect_accounts where id=p_account) then raise exception 'ACCOUNT_NOT_FOUND'; end if;
 if p_patch ? 'profile' and jsonb_typeof(p_patch->'profile') <> 'object' then raise exception 'INVALID_FIELD:profile'; end if;
 if p_patch ? 'score_components' and jsonb_typeof(p_patch->'score_components') <> 'object' then raise exception 'INVALID_FIELD:score_components'; end if;
 st := p_patch->>'status';
 if st is not null and st not in ('descubierto', 'enriquecido', 'calificado', 'en_cola', 'descartado') then raise exception 'INVALID_FIELD:status'; end if;
 if st = 'descartado' and length(btrim(coalesce(p_patch->>'discard_reason', ''))) = 0 then raise exception 'REASON_REQUIRED'; end if;

 insert into prospect_profiles(account_id, status, updated_by) values (p_account, coalesce(st, 'descubierto'), p_actor)
  on conflict (account_id) do nothing;
 select * into a from prospect_profiles where account_id=p_account for update;
 merged := a.profile;
 if p_patch ? 'profile' then merged := jsonb_strip_nulls(a.profile || (p_patch->'profile')); end if;

 update prospect_profiles set
  profile=merged,
  status=coalesce(st, status),
  discard_reason=case when st = 'descartado' then btrim(p_patch->>'discard_reason') when st is not null then null else discard_reason end,
  score=case when p_patch ? 'score' then (p_patch->>'score')::numeric else score end,
  score_components=case when p_patch ? 'score_components' then p_patch->'score_components' else score_components end,
  scoring_version=case when p_patch ? 'scoring_version' then nullif(btrim(p_patch->>'scoring_version'), '') else scoring_version end,
  explore=case when p_patch ? 'explore' then coalesce((p_patch->>'explore')::boolean, false) when st is not null and st <> 'en_cola' then false else explore end,
  queued_at=case when st = 'en_cola' and p_patch ? 'snapshot' then now() when st is not null and st <> 'en_cola' then null else queued_at end,
  queue_snapshot=case when st = 'en_cola' and p_patch ? 'snapshot' then p_patch->'snapshot' when st is not null and st <> 'en_cola' then null else queue_snapshot end,
  updated_by=p_actor, updated_at=now()
 where account_id=p_account returning * into b;

 if st is not null and st is distinct from a.status then
  insert into prospect_events(account_id, type, occurred_at, actor, source, details)
   values (p_account, 'account_updated', now(), p_actor, 'manual',
    jsonb_build_object('changes', jsonb_build_object('prospecto', jsonb_build_object('from', a.status, 'to', st, 'reason', b.discard_reason))));
 end if;
 return to_jsonb(b);
end $$;

-- Los perfiles y lo que la vista necesita de cada cuenta y no trae el dataset
-- (dirección, origen y la fila original de la planilla de las pendientes).
create or replace function public.habita_prospect_pool() returns jsonb
 language sql stable security definer set search_path=public as $$
 select jsonb_build_object(
  'profiles', coalesce((select jsonb_agg(to_jsonb(p)) from prospect_profiles p), '[]'),
  'extra', coalesce((select jsonb_agg(jsonb_build_object('account_id', pa.id, 'address', pa.address, 'source', pa.source,
     'source_data', case when pa.stage = 'pending' then pa.source_data else '{}'::jsonb end,
     'source_notes', case when pa.stage = 'pending' then pa.source_notes else null end)) from prospect_accounts pa), '[]')
 )
$$;

do $$ declare f text; begin
 foreach f in array array['habita_prospect_pool_save(uuid,uuid,jsonb)', 'habita_prospect_pool()'] loop
  execute format('revoke all on function public.%s from public, anon, authenticated', f);
  execute format('grant execute on function public.%s to service_role', f);
 end loop;
end $$;
