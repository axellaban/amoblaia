-- The sheet's new «Estado» values (sync of the prospecting sheet). Replaces
-- habita_prospect_sheet_stages (202611270001) with the same signature:
-- * contacted («Contactado»): at least «sent», even without a date;
-- * replied («Responde saludo inicial»): one human reply to the greeting;
-- * neutral («Neutro»): the reply, and an answer to the proposal that is
--   neither interest nor loss (a reply with details.proposal = true);
-- * interested («Interesado», «Demo enviada»): the reply and one interest;
-- * lost («No interesado», «No interesado - cuenta con proveedor de IA»):
--   the reply, one «not_interested» answer, and the account lost with the
--   row's reason, so each reason is measured apart.
-- «Respondieron la propuesta» = a valid interest, a not_interested, or a
-- reply marked as an answer to the proposal (habita_prospect_proposal_answered).
-- Each fact is recorded once per account: every hourly sync repeats the same
-- rows and records nothing new. Only moves forward: a lost or discarded
-- account (by the team or by an earlier sync) is left as it is, and a stage
-- set by hand is never lowered. Evidence keeps the sheet's own words.
-- Idempotent: safe to run again.
begin;

-- Whether the account answered the proposal (not corrected away).
create or replace function public.habita_prospect_proposal_answered(p_account uuid) returns boolean
 language sql stable security definer set search_path=public as $$
 select exists (select 1 from prospect_events e where e.account_id=p_account
  and (e.type in ('interest', 'not_interested') or (e.type='reply' and e.human is not false and coalesce((e.details->>'proposal')::boolean, false)))
  and not exists (select 1 from prospect_events c where c.corrects_event_id=e.id))
$$;

create or replace function public.habita_prospect_sheet_stages(p_actor uuid, p_source text, p_rows jsonb, p_channel text)
 returns jsonb language plpgsql security definer set search_path=public as $$
declare r jsonb; acc prospect_accounts; v_stage text; v_day date; v_at timestamptz; v_prec text; lchannel text; v_ev text; v_reason text;
 v_replies integer := 0; v_interests integer := 0; v_contacted integer := 0; v_neutral integer := 0; v_lost integer := 0;
begin
 if p_source is null or length(btrim(p_source)) = 0 then raise exception 'INVALID_SOURCE'; end if;
 if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 5000 then raise exception 'INVALID_ROWS'; end if;
 lchannel := case when p_channel in ('whatsapp', 'email') then p_channel else 'unknown' end;
 for r in select * from jsonb_array_elements(p_rows) loop
  v_stage := r->>'stage';
  if v_stage is null or v_stage not in ('contacted', 'replied', 'neutral', 'interested', 'lost') then continue; end if;
  v_reason := left(nullif(btrim(coalesce(r->>'reason', '')), ''), 300);
  if v_stage = 'lost' and v_reason is null then continue; end if;
  select * into acc from prospect_accounts where source=btrim(p_source) and source_key=r->>'source_key' for update;
  if not found or acc.stage in ('lost', 'discarded') then continue; end if;
  -- The sheet has no reply date: the day of the send when there is one, else when the sync first saw it.
  v_day := case when coalesce(r->>'date', '') ~ '^\d{4}-\d{2}-\d{2}$' then (r->>'date')::date end;
  v_at := case when v_day is not null then (v_day::text || ' 12:00:00-03')::timestamptz else now() end;
  v_prec := case when v_day is not null then 'day' else 'time' end;
  v_ev := 'Planilla: ' || left(coalesce(nullif(btrim(r->>'status'), ''), v_stage), 80);
  if acc.stage = 'pending' then
   perform habita_prospect_advance(acc.id, 'sent');
   v_contacted := v_contacted + 1;
  end if;
  if v_stage <> 'contacted' and not habita_prospect_replied(acc.id) then
   insert into prospect_events(account_id, type, occurred_at, occurred_precision, actor, source, channel, human, evidence, details)
    values (acc.id, 'reply', v_at, v_prec, p_actor, 'import', lchannel, true, v_ev, jsonb_build_object('sheet', true));
   perform habita_prospect_advance(acc.id, 'conversation');
   v_replies := v_replies + 1;
  end if;
  if v_stage = 'neutral' and not habita_prospect_proposal_answered(acc.id) then
   insert into prospect_events(account_id, type, occurred_at, occurred_precision, actor, source, channel, human, evidence, details)
    values (acc.id, 'reply', v_at, v_prec, p_actor, 'import', lchannel, true, v_ev, jsonb_build_object('sheet', true, 'proposal', true));
   v_neutral := v_neutral + 1;
  end if;
  if v_stage = 'interested' and not exists (select 1 from prospect_events e where e.account_id=acc.id and e.type='interest'
    and not exists (select 1 from prospect_events c where c.corrects_event_id=e.id)) then
   insert into prospect_events(account_id, type, occurred_at, occurred_precision, actor, source, channel, evidence, details)
    values (acc.id, 'interest', v_at, v_prec, p_actor, 'import', lchannel, v_ev, jsonb_build_object('sheet', true));
   perform habita_prospect_advance(acc.id, 'interested');
   v_interests := v_interests + 1;
  end if;
  -- A loss is recorded with its answer, once: an account the team reopened after it keeps the team's stage.
  if v_stage = 'lost' and not exists (select 1 from prospect_events e where e.account_id=acc.id and e.type='not_interested'
    and not exists (select 1 from prospect_events c where c.corrects_event_id=e.id)) then
   insert into prospect_events(account_id, type, occurred_at, occurred_precision, actor, source, channel, human, evidence, details)
    values (acc.id, 'not_interested', v_at, v_prec, p_actor, 'import', lchannel, true, v_ev, jsonb_build_object('sheet', true, 'reason', v_reason));
   insert into prospect_events(account_id, type, occurred_at, occurred_precision, actor, source, evidence, details)
    values (acc.id, 'lost', v_at, v_prec, p_actor, 'import', v_ev, jsonb_build_object('sheet', true, 'reason', v_reason));
   update prospect_accounts set stage='lost', lost_reason=v_reason, version=version+1 where id=acc.id;
   v_lost := v_lost + 1;
  end if;
 end loop;
 return jsonb_build_object('contacted', v_contacted, 'replies', v_replies, 'neutral', v_neutral, 'interests', v_interests, 'lost', v_lost);
end $$;

revoke all on function public.habita_prospect_proposal_answered(uuid) from public, anon, authenticated;
grant execute on function public.habita_prospect_proposal_answered(uuid) to service_role;
revoke all on function public.habita_prospect_sheet_stages(uuid,text,jsonb,text) from public, anon, authenticated;
grant execute on function public.habita_prospect_sheet_stages(uuid,text,jsonb,text) to service_role;
commit;
