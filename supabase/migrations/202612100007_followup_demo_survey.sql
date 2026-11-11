alter table public.followup_rules drop constraint followup_closing_survey_check,
  add constraint followup_closing_survey_check check (
    (action <> 'encuesta_cierre' and not ('rechazo' = any(situations))) or
    (stage in ('no-responde','sin-demo','sin-enviar','no-abrio','sin-interaccion','sin-cuenta')
      and action='encuesta_cierre' and situations=array['rechazo'])
  );
