alter table public.followup_versions drop constraint followup_versions_action_check,
  add constraint followup_versions_action_check check (action in ('principal','seguimiento_2','presentacion','presentacion_seguimiento','precios','encuesta_cierre'));
alter table public.followup_rules drop constraint followup_rules_action_check,
  add constraint followup_rules_action_check check (action in ('principal','seguimiento_2','presentacion','presentacion_seguimiento','precios','encuesta_cierre')),
  drop constraint followup_rules_situations_check,
  add constraint followup_rules_situations_check check (situations <@ array['sin_respuesta','confirmo_numero','interesado','neutro','pregunta_precios','mas_adelante','derivo','rechazo']),
  add constraint followup_closing_survey_check check (
    (action <> 'encuesta_cierre' and not ('rechazo' = any(situations))) or
    (stage = 'no-responde' and action = 'encuesta_cierre' and situations = array['rechazo'])
  );

-- Repair only the misconfigured survey, preserving its wording, priority and schedule.
do $$
declare source public.followup_versions;
begin
  select * into source from public.followup_versions where stage='no-responde' and action='principal' and status='active';
  if source.body like 'Ok, mil gracias por la respuesta!%' and exists (
    select 1 from public.followup_rules where stage='no-responde' and position=60 and name='No interesado' and action='principal'
  ) then
    perform public.habita_followup_create(source.created_by,'no-responde','whatsapp','Respondió que no le interesa',source.body,source.ctas,'active','encuesta_cierre');
    update public.followup_rules set action='encuesta_cierre', situations=array['rechazo'], after_action=null, updated_at=now()
      where stage='no-responde' and position=60 and name='No interesado' and action='principal';
    update public.followup_versions set status='archived',status_at=now() where id=source.id;
  end if;
end $$;
