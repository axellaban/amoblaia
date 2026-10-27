-- Import options for the real prospecting sheet:
-- * a contact the sheet marks as verified ("WhatsApp verificado") arrives
--   verified, so it can be used without a second manual check;
-- * the team states the channel of the sheet's past sends (WhatsApp, email
--   or unknown) when importing. The variant of those sends stays unknown.
-- Replaces habita_prospect_import with one more argument; the 8-argument
-- version is dropped so the server cannot call an outdated one.
-- Idempotent: safe to run again.
begin;
drop function if exists public.habita_prospect_import(uuid,uuid,text,text,text,jsonb,jsonb,boolean);

-- Applies a reviewed import (v2: verified contacts from the sheet and the
-- channel of its past sends, stated by the team at import time). Rows are matched by (source, source_key): a
-- second run updates the source fields and never duplicates accounts,
-- contacts or legacy sends. Operational fields (SDR, next action, stage) are
-- only overwritten when p_overwrite is true. Idempotent per import id.
create or replace function public.habita_prospect_import(p_actor uuid, p_import uuid, p_source text, p_file_name text, p_file_hash text, p_mapping jsonb, p_rows jsonb, p_overwrite boolean, p_legacy_channel text)
 returns jsonb language plpgsql security definer set search_path=public as $$
declare imp prospect_imports; r jsonb; acc prospect_accounts; ag uuid; ct jsonb; v_outcome text; msgs jsonb; v_created integer := 0; v_updated integer := 0;
 v_unchanged integer := 0; v_conflicts integer := 0; v_legacy integer := 0; v_contacts integer := 0; k integer; sent_day date; cid uuid; before jsonb; v_report jsonb;
 lkey text; att uuid; lchannel text;
begin
 select * into imp from prospect_imports where id=p_import;
 if found then
  if imp.status='applied' then return imp.report || jsonb_build_object('replayed', true); end if;
  raise exception 'IMPORT_IN_PROGRESS';
 end if;
 if p_source is null or length(btrim(p_source)) = 0 then raise exception 'INVALID_SOURCE'; end if;
 if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 5000 then raise exception 'INVALID_ROWS'; end if;
 insert into prospect_imports(id, source, file_name, file_hash, mapping, created_by) values (p_import, btrim(p_source), p_file_name, p_file_hash, coalesce(p_mapping, '{}'), p_actor);
 for r in select * from jsonb_array_elements(p_rows) loop
  msgs := '[]';
  if coalesce(btrim(r->>'source_key'), '') = '' or coalesce(btrim(r->>'name'), '') = '' then
   insert into prospect_import_rows(import_id, row_number, source_key, outcome, messages, raw)
    values (p_import, (r->>'row_number')::int, coalesce(r->>'source_key', ''), 'error', '["Falta el nombre o la clave de la fila"]', coalesce(r->'raw', '{}'));
   continue;
  end if;
  select * into acc from prospect_accounts where source=btrim(p_source) and source_key=r->>'source_key' for update;
  if found then
   before := jsonb_build_object('score', acc.score, 'score_components', acc.score_components, 'source_notes', acc.source_notes, 'source_data', acc.source_data,
    'zone', acc.zone, 'address', acc.address, 'priority', acc.priority, 'decision_maker', acc.decision_maker);
   update prospect_accounts set
    score=(r->>'score')::numeric, score_components=coalesce(r->'score_components', '{}'), scoring_version=coalesce(r->>'scoring_version', scoring_version),
    priority=r->>'priority', zone=r->>'zone', address=r->>'address', source_notes=r->>'notes', source_data=coalesce(r->'raw', '{}'),
    decision_maker=coalesce(decision_maker, r->>'decision_maker'),
    sdr=case when p_overwrite then r->>'sdr' else coalesce(sdr, r->>'sdr') end,
    campaign=case when p_overwrite then r->>'campaign' else coalesce(campaign, r->>'campaign') end,
    last_import_id=p_import, imported_at=now(), version=version+1
   where id=acc.id;
   if before is distinct from jsonb_build_object('score', (r->>'score')::numeric, 'score_components', coalesce(r->'score_components', '{}'),
     'source_notes', r->>'notes', 'source_data', coalesce(r->'raw', '{}'), 'zone', r->>'zone', 'address', r->>'address', 'priority', r->>'priority',
     'decision_maker', coalesce(acc.decision_maker, r->>'decision_maker')) then
    v_outcome := 'updated'; v_updated := v_updated + 1;
    insert into prospect_events(account_id, type, occurred_at, actor, source, details)
     values (acc.id, 'imported', now(), p_actor, 'import', jsonb_build_object('import', p_import, 'row', r->'row_number', 'previous', before));
   else
    v_outcome := 'unchanged'; v_unchanged := v_unchanged + 1;
   end if;
  else
   ag := nullif(r->>'agency_id', '')::uuid;
   if ag is not null then
    if not exists (select 1 from agencies where id=ag) then
     insert into prospect_import_rows(import_id, row_number, source_key, outcome, messages, raw)
      values (p_import, (r->>'row_number')::int, r->>'source_key', 'error', '["La inmobiliaria elegida no existe"]', coalesce(r->'raw', '{}'));
     continue;
    end if;
    if exists (select 1 from prospect_accounts where agency_id=ag) then
     v_conflicts := v_conflicts + 1;
     insert into prospect_import_rows(import_id, row_number, source_key, account_id, outcome, messages, raw)
      values (p_import, (r->>'row_number')::int, r->>'source_key', (select id from prospect_accounts where agency_id=ag), 'conflict',
       '["La inmobiliaria ya está en la base desde otra fila u origen: revisá la fusión a mano"]', coalesce(r->'raw', '{}'));
     continue;
    end if;
   else
    insert into agencies(name, website, created_by) values (left(btrim(r->>'name'), 120), left(nullif(r->>'website', ''), 300), p_actor) returning id into ag;
   end if;
   insert into prospect_accounts(agency_id, source, source_key, campaign, sdr, priority, score, score_components, scoring_version, zone, address,
     decision_maker, source_notes, source_data, imported_at, last_import_id, created_by)
    values (ag, btrim(p_source), r->>'source_key', r->>'campaign', r->>'sdr', r->>'priority', (r->>'score')::numeric, coalesce(r->'score_components', '{}'),
     r->>'scoring_version', r->>'zone', r->>'address', r->>'decision_maker', r->>'notes', coalesce(r->'raw', '{}'), now(), p_import, p_actor)
    returning * into acc;
   insert into prospect_events(account_id, type, occurred_at, actor, source, details)
    values (acc.id, 'imported', now(), p_actor, 'import', jsonb_build_object('import', p_import, 'row', r->'row_number', 'status', r->>'legacy_status'));
   v_outcome := 'created'; v_created := v_created + 1;
  end if;
  -- Contacts: added when new; existing ones (same channel and address) are kept as they are.
  for ct in select * from jsonb_array_elements(coalesce(r->'contacts', '[]')) loop
   cid := null;
   if ct->>'address' is not null then
    select id into cid from prospect_contacts where account_id=acc.id and channel=ct->>'channel' and address=ct->>'address';
   else
    select id into cid from prospect_contacts where account_id=acc.id and channel=ct->>'channel' and address is null and address_original=ct->>'address_original';
   end if;
   if cid is null then
    insert into prospect_contacts(account_id, person_name, is_decision_maker, channel, address, address_original, confidence, source, source_url,
      needs_review, review_reason, verified_at, verified_by, invalid_at, invalid_reason, is_primary, created_by)
     values (acc.id, ct->>'person_name', coalesce((ct->>'is_decision_maker')::boolean, false), ct->>'channel', ct->>'address', ct->>'address_original',
      ct->>'confidence', ct->>'source', ct->>'source_url', coalesce((ct->>'needs_review')::boolean, false), ct->>'review_reason',
      case when (ct->>'verified')::boolean then now() end, case when (ct->>'verified')::boolean then p_actor end,
      case when (ct->>'invalid')::boolean then now() end, case when (ct->>'invalid')::boolean then ct->>'invalid_reason' end,
      coalesce((ct->>'is_primary')::boolean, false) and not exists (select 1 from prospect_contacts where account_id=acc.id and is_primary), p_actor)
     returning id into cid;
    v_contacts := v_contacts + 1;
   elsif (ct->>'verified')::boolean then
    -- The sheet now says it is verified: mark it, keeping an earlier verification and an invalid mark as they are.
    update prospect_contacts set verified_at=coalesce(verified_at, now()), verified_by=coalesce(verified_by, p_actor),
      needs_review=case when invalid_at is null then false else needs_review end, review_reason=case when invalid_at is null then null else review_reason end
     where id=cid and verified_at is null;
   elsif (ct->>'invalid')::boolean then
    -- "Número incorrecto" in the sheet invalidates that endpoint only.
    update prospect_contacts set invalid_at=coalesce(invalid_at, now()), invalid_reason=coalesce(invalid_reason, ct->>'invalid_reason'), is_primary=false where id=cid;
   end if;
  end loop;
  -- A legacy "Enviado" with a date: one send with day precision, channel and variant unknown.
  sent_day := nullif(r->>'sent_date', '')::date;
  -- The team states the channel of the whole sheet's past sends (or leaves it unknown); a variant is never inferred.
  lchannel := case when p_legacy_channel in ('whatsapp', 'email') then p_legacy_channel else 'unknown' end;
  if r->>'legacy_status'='sent' then
   lkey := btrim(p_source) || ':' || (r->>'source_key') || ':sent:' || coalesce(sent_day::text, 'sin-fecha');
   if sent_day is not null and not exists (select 1 from outreach_attempts o where o.legacy_key=lkey) then
    select count(*) into k from outreach_attempts where account_id=acc.id and status in ('sent', 'bounced');
    insert into outreach_attempts(idempotency_key, legacy_key, account_id, campaign, step, ordinal, variant_label, channel, status, prepared_at, prepared_by,
      sent_at, sent_precision, confirmed_at, confirmed_by, verification_method, legacy, evidence)
     values (gen_random_uuid(), lkey, acc.id, coalesce(r->>'campaign', 'general'), 1, k + 1, null, lchannel, 'sent',
      (sent_day::text || ' 00:00:00-03')::timestamptz, p_actor, (sent_day::text || ' 00:00:00-03')::timestamptz, 'day', now(), p_actor, 'imported', true,
      left('Planilla: ' || coalesce(r->>'notes', ''), 500))
     returning id into att;
    insert into prospect_events(account_id, attempt_id, type, occurred_at, occurred_precision, actor, source, channel, details)
     values (acc.id, att, 'sent', (sent_day::text || ' 00:00:00-03')::timestamptz, 'day', p_actor, 'import', lchannel,
      jsonb_build_object('legacy', true, 'import', p_import, 'variant', null));
    perform habita_prospect_advance(acc.id, 'sent');
    v_legacy := v_legacy + 1;
   elsif sent_day is null then
    msgs := msgs || '["Figura como Enviado sin fecha: no se registró un envío"]';
   end if;
  end if;
  insert into prospect_import_rows(import_id, row_number, source_key, account_id, outcome, messages, raw)
   values (p_import, (r->>'row_number')::int, r->>'source_key', acc.id, v_outcome, msgs || coalesce(r->'messages', '[]'), coalesce(r->'raw', '{}'));
 end loop;
 v_report := jsonb_build_object('import', p_import, 'created', v_created, 'updated', v_updated, 'unchanged', v_unchanged, 'conflicts', v_conflicts,
  'errors', (select count(*) from prospect_import_rows where import_id=p_import and outcome='error'), 'legacy_sends', v_legacy, 'contacts', v_contacts);
 update prospect_imports set status='applied', applied_at=now(), report=v_report where id=p_import;
 return v_report;
end $$;

revoke all on function public.habita_prospect_import(uuid,uuid,text,text,text,jsonb,jsonb,boolean,text) from public, anon, authenticated;
grant execute on function public.habita_prospect_import(uuid,uuid,text,text,text,jsonb,jsonb,boolean,text) to service_role;
commit;
