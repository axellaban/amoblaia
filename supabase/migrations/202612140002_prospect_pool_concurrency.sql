-- Optimistic concurrency and persistent manual exclusion for Prospectos.
-- Apply only after integration QA. No data backfill or production deployment here.
create or replace function public.habita_prospect_pool_save(p_actor uuid, p_account uuid, p_patch jsonb)
 returns jsonb language plpgsql security definer set search_path=public as $$
declare a prospect_profiles; b prospect_profiles; k text; merged jsonb; st text;
 allowed constant text[] := array['profile', 'status', 'discard_reason', 'score', 'score_components', 'scoring_version', 'explore', 'snapshot', 'expected_updated_at'];
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
 if p_patch ? 'expected_updated_at' then
  if (p_patch->>'expected_updated_at') is null then
   if a.created_at is distinct from a.updated_at then raise exception 'STALE_PROFILE'; end if;
  elsif a.updated_at is distinct from (p_patch->>'expected_updated_at')::timestamptz then
   raise exception 'STALE_PROFILE';
  end if;
 end if;
 if st = 'en_cola' and a.status <> 'en_cola' and (a.status = 'descartado' or coalesce((a.profile->>'manual_queue_hold')::boolean,false)) then
  raise exception 'QUEUE_MANUAL_HOLD';
 end if;
 merged := a.profile;
 if p_patch ? 'profile' then merged := jsonb_strip_nulls(a.profile || (p_patch->'profile')); end if;
 -- A manual removal must survive subsequent saves/recalculation. A generic profile patch
 -- cannot silently clear the persisted exclusion; only a dedicated reactivation flow may do so.
 if st is not null and a.status = 'en_cola' and st <> 'en_cola' then
  merged := jsonb_set(merged, '{manual_queue_hold}', 'true'::jsonb, true);
 elsif coalesce((a.profile->>'manual_queue_hold')::boolean, false) then
  merged := jsonb_set(merged, '{manual_queue_hold}', 'true'::jsonb, true);
 end if;

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

