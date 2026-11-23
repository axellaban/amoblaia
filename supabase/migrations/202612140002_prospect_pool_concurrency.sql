-- Optimistic concurrency and persistent manual exclusion for Prospectos.
-- Apply only after integration QA. No data backfill or production deployment here.
create or replace function public.habita_prospect_pool_save(p_actor uuid, p_account uuid, p_patch jsonb)
 returns jsonb language plpgsql security definer set search_path=public as $$
declare a prospect_profiles; b prospect_profiles; k text; merged jsonb; st text; inserted_account uuid;
 allowed constant text[] := array['profile', 'status', 'discard_reason', 'score', 'score_components', 'scoring_version', 'explore', 'snapshot', 'expected_updated_at', 'manual_queue_action'];
begin
 if jsonb_typeof(p_patch) is distinct from 'object' then raise exception 'INVALID_FIELD:patch'; end if;
 for k in select jsonb_object_keys(p_patch) loop
  if not k = any(allowed) then raise exception 'INVALID_FIELD:%', k; end if;
 end loop;
 if not exists (select 1 from prospect_accounts where id=p_account) then raise exception 'ACCOUNT_NOT_FOUND'; end if;
 if not (p_patch ? 'expected_updated_at') then raise exception 'EXPECTED_VERSION_REQUIRED'; end if;
 if p_patch ? 'profile' and jsonb_typeof(p_patch->'profile') is distinct from 'object' then raise exception 'INVALID_FIELD:profile'; end if;
 if p_patch ? 'score_components' and jsonb_typeof(p_patch->'score_components') is distinct from 'object' then raise exception 'INVALID_FIELD:score_components'; end if;
 -- JSON null must not bypass the action whitelist (SQL NOT IN yields NULL).
 if p_patch ? 'manual_queue_action' and
    (jsonb_typeof(p_patch->'manual_queue_action') is distinct from 'string' or
     p_patch->>'manual_queue_action' not in ('remove', 'reactivate')) then
  raise exception 'INVALID_FIELD:manual_queue_action';
 end if;
 st := p_patch->>'status';

 if st is not null and st not in ('descubierto', 'enriquecido', 'calificado', 'en_cola', 'descartado') then raise exception 'INVALID_FIELD:status'; end if;
 if st = 'descartado' and length(btrim(coalesce(p_patch->>'discard_reason', ''))) = 0 then raise exception 'REASON_REQUIRED'; end if;

 -- Insert in discovered state first so a first-write queue admission is a real transition
 -- and cannot bypass QUEUE_SNAPSHOT_REQUIRED.
 insert into prospect_profiles(account_id, status, updated_by) values (p_account, 'descubierto', p_actor)
  on conflict (account_id) do nothing returning account_id into inserted_account;
 select * into a from prospect_profiles where account_id=p_account for update;
 -- Every write must carry an expected version. NULL is valid only for a newly inserted row.
 if inserted_account is not null then
  if p_patch->>'expected_updated_at' is not null then raise exception 'STALE_PROFILE'; end if;
 elsif p_patch->>'expected_updated_at' is null or
       a.updated_at is distinct from (p_patch->>'expected_updated_at')::timestamptz then
  raise exception 'STALE_PROFILE';
 end if;
 if p_patch->>'manual_queue_action' = 'remove' and (a.status <> 'en_cola' or st is null or st = 'en_cola') then raise exception 'INVALID_QUEUE_ACTION'; end if;
 if p_patch->>'manual_queue_action' = 'reactivate' and (st <> 'en_cola' or a.status = 'en_cola' or not (p_patch ? 'snapshot')) then raise exception 'INVALID_QUEUE_ACTION'; end if;
 -- Reactivation is reserved for a previously manually held prospect; a regular queue add must not masquerade as reactivation.
 if p_patch->>'manual_queue_action' = 'reactivate' and not coalesce((a.profile->>'manual_queue_hold')::boolean,false) then raise exception 'INVALID_QUEUE_ACTION'; end if;
 -- A snapshot is written only on admission; repeat saves must not rewrite queue provenance.
 if p_patch ? 'snapshot' and (st is distinct from 'en_cola' or a.status = 'en_cola') then
  raise exception 'INVALID_QUEUE_SNAPSHOT_TRANSITION';
 end if;
 -- A queue transition must persist a complete immutable snapshot, never a null or arbitrary scalar.
 if st = 'en_cola' and a.status <> 'en_cola' and
    (jsonb_typeof(p_patch->'snapshot') is distinct from 'object' or
     jsonb_typeof(p_patch->'snapshot'->'profile') is distinct from 'object' or
     jsonb_typeof(p_patch->'snapshot'->'score') is distinct from 'number') then
  raise exception 'QUEUE_SNAPSHOT_REQUIRED';
 end if;
 if st = 'en_cola' and a.status <> 'en_cola' and (a.status = 'descartado' or (coalesce((a.profile->>'manual_queue_hold')::boolean,false) and p_patch->>'manual_queue_action' is distinct from 'reactivate')) then
  raise exception 'QUEUE_MANUAL_HOLD';
 end if;
 merged := a.profile;
 if p_patch ? 'profile' then merged := jsonb_strip_nulls(a.profile || (p_patch->'profile')); end if;
 -- The manual hold is server-owned metadata: ordinary profile edits cannot forge or clear it.
 -- This also prevents a profile payload on explicit reactivation from reintroducing a hold.
 merged := merged - 'manual_queue_hold';
 -- A manual removal must survive subsequent saves/recalculation. A generic profile patch
 -- cannot silently clear the persisted exclusion; only a dedicated reactivation flow may do so.
 if p_patch->>'manual_queue_action' = 'remove' or
    (a.status = 'en_cola' and st is not null and st <> 'en_cola' and st <> 'descartado') then
  -- Legacy/manual status-only removal must also persist suppression; otherwise
  -- a later recalculation could immediately put the account back into the queue.
  merged := jsonb_set(merged, '{manual_queue_hold}', 'true'::jsonb, true);
 elsif p_patch->>'manual_queue_action' = 'reactivate' then
  merged := merged - 'manual_queue_hold';
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
  queued_at=case when st = 'en_cola' and a.status <> 'en_cola' and p_patch ? 'snapshot' then now() when st is not null and st <> 'en_cola' then null else queued_at end,
  queue_snapshot=case when st = 'en_cola' and a.status <> 'en_cola' and p_patch ? 'snapshot' then p_patch->'snapshot' when st is not null and st <> 'en_cola' then null else queue_snapshot end,
  -- A transaction-stable now() can reuse the same version across consecutive writes.
  -- Force a strictly increasing timestamp so optimistic concurrency detects every save.
  updated_by=p_actor, updated_at=greatest(clock_timestamp(), a.updated_at + interval '1 microsecond')
 where account_id=p_account returning * into b;

 if st is not null and st is distinct from a.status then
  insert into prospect_events(account_id, type, occurred_at, actor, source, details)
   values (p_account, 'account_updated', now(), p_actor, 'manual',
    jsonb_build_object('changes', jsonb_build_object('prospecto', jsonb_build_object('from', a.status, 'to', st, 'reason', b.discard_reason))));
 end if;
 return to_jsonb(b);
end $$;

