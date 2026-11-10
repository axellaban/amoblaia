-- Adjustable rolling 24-hour greeting cap for Follow-up. Service-role only.
-- Manual external greetings are a conservative estimate anchored at the edit time.
begin;
create table if not exists public.followup_quota_settings (
  id boolean primary key default true check (id),
  cap integer not null default 48 check (cap between 1 and 500),
  external_count integer not null default 0 check (external_count between 0 and 10000),
  external_updated_at timestamptz,
  updated_at timestamptz not null default now()
);
insert into public.followup_quota_settings (id,cap) values (true,48) on conflict (id) do nothing;
alter table public.followup_quota_settings enable row level security;
revoke all on public.followup_quota_settings from public, anon, authenticated;
grant select,update on public.followup_quota_settings to service_role;

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
  v_cap integer;
  v_external integer;
begin
  if p_status = 'sent' then
    select stage into v_stage from public.followup_versions where id = p_version;
    if v_stage is null then raise exception 'FOLLOWUP_VERSION_NOT_FOUND'; end if;
    if v_stage = 'no-contactado' then
      perform pg_advisory_xact_lock(hashtext('habita_followup_first_contact_cap'));

      select cap, case when external_updated_at > now() - interval '24 hours' then external_count else 0 end
      into v_cap, v_external from public.followup_quota_settings where id = true;
      v_cap := coalesce(v_cap, 48);
      v_external := coalesce(v_external, 0);

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
        if v_used + v_external >= v_cap then
          raise exception 'FOLLOWUP_FIRST_CONTACT_CAP_REACHED';
        end if;
      end if;
    end if;
  end if;

  return public.habita_followup_mark(
    p_actor, p_version, p_agency, p_from_step, p_status, p_reason, p_body
  );
end $$;

commit;
