alter table public.followup_stage_situation_overrides add column enabled boolean not null default true;
alter table public.followup_agencies add column rejection_stage text;
alter table public.followup_rules drop constraint followup_closing_survey_check,
  add constraint followup_closing_survey_check check (
    (action <> 'encuesta_cierre' and not ('rechazo' = any(situations))) or
    (stage in ('no-responde','sin-demo','sin-enviar') and action='encuesta_cierre' and situations=array['rechazo'])
  );
create unique index followup_survey_once_per_agency on public.followup_executions(agency_id)
  where action='encuesta_cierre' and status='sent';

create function public.habita_toggle_base_situation(p_stage text,p_key text,p_label text,p_enabled boolean)
returns void language sql set search_path='' as $$
  insert into public.followup_stage_situation_overrides(commercial_stage,key,label,enabled)
    values(p_stage,p_key,p_label,p_enabled)
    on conflict(commercial_stage,key) do update set enabled=excluded.enabled
    where not followup_stage_situation_overrides.removed
$$;
revoke all on function public.habita_toggle_base_situation(text,text,text,boolean) from public,anon,authenticated;
grant execute on function public.habita_toggle_base_situation(text,text,text,boolean) to service_role;
