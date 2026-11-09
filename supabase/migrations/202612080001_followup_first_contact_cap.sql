-- Follow-up: enforce the 50-new-contact rolling 24h quota at confirmation.
-- Safe additive wrapper: the existing RPC and all history remain unchanged.
-- The lock serializes confirmations coming from Follow-up. Independently
-- recorded sends in Adquisición are counted, but that other workflow must
-- take the same lock to provide a cross-workflow atomic guarantee.
begin;

create or replace function public.habita_followup_mark_capped(
  p_actor uuid,
  p_version uuid,
  p_agency uuid,
  p_from_step integer,
  p_status text,
  p_reason text,
  p_body text default null
)
returns public.followup_executions
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_stage text;
  v_already_counted boolean;
  v_used integer;
begin
  if p_status = 'sent' then
    select stage into v_stage from public.followup_versions where id = p_version;
    if v_stage is null then raise exception 'FOLLOWUP_VERSION_NOT_FOUND'; end if;
    if v_stage = 'no-contactado' then
      perform pg_advisory_xact_lock(hashtext('habita_followup_first_contact_cap'));

      select exists (
        select 1 from public.followup_executions e
        where e.agency_id = p_agency and e.stage = 'no-contactado'
          and e.status = 'sent' and e.sent_at >= now() - interval '24 hours'
        union all
        select 1 from public.outreach_attempts a
          join public.prospect_accounts pa on pa.id = a.account_id
        where pa.agency_id = p_agency and a.status = 'sent' and a.step = 1
          and a.sent_at >= now() - interval '24 hours'
      ) into v_already_counted;

      if not v_already_counted then
        select count(*) into v_used from (
          select e.agency_id
            from public.followup_executions e
            where e.stage = 'no-contactado' and e.status = 'sent'
              and e.sent_at >= now() - interval '24 hours'
          union
          select pa.agency_id
            from public.outreach_attempts a
              join public.prospect_accounts pa on pa.id = a.account_id
            where a.status = 'sent' and a.step = 1
              and a.sent_at >= now() - interval '24 hours'
        ) first_contacts;
        if v_used >= 50 then
          raise exception 'FOLLOWUP_FIRST_CONTACT_CAP_REACHED';
        end if;
      end if;
    end if;
  end if;

  return public.habita_followup_mark(
    p_actor, p_version, p_agency, p_from_step, p_status, p_reason, p_body
  );
end $$;

revoke all on function public.habita_followup_mark_capped(uuid, uuid, uuid, integer, text, text, text)
  from public, anon, authenticated;
grant execute on function public.habita_followup_mark_capped(uuid, uuid, uuid, integer, text, text, text)
  to service_role;

commit;
