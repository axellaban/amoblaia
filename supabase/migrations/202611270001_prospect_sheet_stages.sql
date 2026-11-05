-- The sheet's «Estado» column moves the prospecting stage, for the funnel of
-- the «Inmobiliarias» panel (Contactados → Saludo respondido → Interesados):
-- * «Contactado» (like «Enviado»): at least «sent», even without a date;
-- * «Respondió saludo»: one human reply, recorded once per account;
-- * «Interesado»: one interest (and the reply before it), recorded once.
-- Called by the sheet sync after habita_prospect_import, which already
-- records the dated send. Rows are matched by (source, source_key). Only
-- moves forward: a stage the team set by hand is never lowered, and a reply
-- or interest the account already has is not repeated.
-- Idempotent: safe to run again, and every sync can repeat the same rows.
begin;

create or replace function public.habita_prospect_sheet_stages(p_actor uuid, p_source text, p_rows jsonb, p_channel text)
 returns jsonb language plpgsql security definer set search_path=public as $$
declare r jsonb; acc prospect_accounts; v_stage text; v_day date; v_at timestamptz; v_prec text; lchannel text;
 v_replies integer := 0; v_interests integer := 0; v_contacted integer := 0;
begin
 if p_source is null or length(btrim(p_source)) = 0 then raise exception 'INVALID_SOURCE'; end if;
 if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 5000 then raise exception 'INVALID_ROWS'; end if;
 lchannel := case when p_channel in ('whatsapp', 'email') then p_channel else 'unknown' end;
 for r in select * from jsonb_array_elements(p_rows) loop
  v_stage := r->>'stage';
  if v_stage not in ('contacted', 'replied', 'interested') then continue; end if;
  select * into acc from prospect_accounts where source=btrim(p_source) and source_key=r->>'source_key' for update;
  if not found or acc.stage in ('lost', 'discarded') then continue; end if;
  -- The sheet has no reply date: the day of the send when there is one, else when the sync first saw it.
  v_day := case when coalesce(r->>'date', '') ~ '^\d{4}-\d{2}-\d{2}$' then (r->>'date')::date end;
  v_at := case when v_day is not null then (v_day::text || ' 12:00:00-03')::timestamptz else now() end;
  v_prec := case when v_day is not null then 'day' else 'time' end;
  if acc.stage = 'pending' then
   perform habita_prospect_advance(acc.id, 'sent');
   v_contacted := v_contacted + 1;
  end if;
  if v_stage in ('replied', 'interested') and not habita_prospect_replied(acc.id) then
   insert into prospect_events(account_id, type, occurred_at, occurred_precision, actor, source, channel, human, evidence, details)
    values (acc.id, 'reply', v_at, v_prec, p_actor, 'import', lchannel, true, 'Planilla: ' || left(coalesce(r->>'status', 'Respondió saludo'), 80),
     jsonb_build_object('sheet', true));
   perform habita_prospect_advance(acc.id, 'conversation');
   v_replies := v_replies + 1;
  end if;
  if v_stage = 'interested' and not exists (select 1 from prospect_events e where e.account_id=acc.id and e.type='interest'
    and not exists (select 1 from prospect_events c where c.corrects_event_id=e.id)) then
   insert into prospect_events(account_id, type, occurred_at, occurred_precision, actor, source, channel, evidence, details)
    values (acc.id, 'interest', v_at, v_prec, p_actor, 'import', lchannel, 'Planilla: ' || left(coalesce(r->>'status', 'Interesado'), 80),
     jsonb_build_object('sheet', true));
   perform habita_prospect_advance(acc.id, 'interested');
   v_interests := v_interests + 1;
  end if;
 end loop;
 return jsonb_build_object('contacted', v_contacted, 'replies', v_replies, 'interests', v_interests);
end $$;

revoke all on function public.habita_prospect_sheet_stages(uuid,text,jsonb,text) from public, anon, authenticated;
grant execute on function public.habita_prospect_sheet_stages(uuid,text,jsonb,text) to service_role;
commit;
