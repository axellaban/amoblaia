CREATE OR REPLACE FUNCTION public.habita_followup_create(p_actor uuid, p_stage text, p_channel text, p_trigger text, p_body text, p_ctas text[], p_status text, p_action text DEFAULT 'principal'::text)
 RETURNS followup_versions
 LANGUAGE plpgsql
AS $function$
declare
  v_next integer;
  v_row public.followup_versions;
begin
  if p_status not in ('active', 'test', 'archived') then
    raise exception 'FOLLOWUP_INVALID_STATUS';
  end if;
  perform pg_advisory_xact_lock(hashtext('followup:' || p_stage || ':' || p_action));
  select coalesce(max(version), 0) + 1 into v_next from public.followup_versions where stage = p_stage and action = p_action;
  update public.followup_versions set status = 'archived', status_at = now() where p_status <> 'archived' and stage = p_stage and action = p_action and status = p_status;
  insert into public.followup_versions (stage, action, version, channel, trigger_label, body, ctas, status, created_by)
  values (p_stage, p_action, v_next, p_channel, coalesce(btrim(p_trigger), ''), btrim(p_body), coalesce(p_ctas, '{}'), p_status, p_actor)
  returning * into v_row;
  return v_row;
end $function$
;
CREATE OR REPLACE FUNCTION public.habita_ab_configure(p_actor uuid, p_control uuid, p_variant uuid, p_body text, p_control_intent text, p_variant_intent text, p_winner uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare a followup_versions; b followup_versions; running uuid;
begin
 select * into strict a from followup_versions where id=p_control;
 perform pg_advisory_xact_lock(hashtext('followup:'||a.stage||':'||a.action));
 select * into strict a from followup_versions where id=p_control for update;
 select id into running from followup_versions where stage=a.stage and action=a.action and status='test';
 if p_winner is not null then
  if a.status<>'active' or running is null or running is distinct from p_variant or p_winner not in (a.id,running) then raise exception 'La prueba cambió. Actualizá el panel.'; end if;
  if p_winner=a.id then perform habita_followup_set_status(running,'archived'); else perform habita_followup_set_status(running,'active'); end if;
  return p_winner;
 end if;
 if running is not null then raise exception 'Ya hay una prueba en curso.'; end if;
 if p_variant is null or p_variant=a.id or p_body is not null then raise exception 'Elegí dos versiones guardadas distintas.'; end if;
 select * into b from followup_versions where id=p_variant and stage=a.stage and action=a.action for update;
 if not found or a.channel<>'whatsapp' or b.channel<>'whatsapp' or a.stage<>'no-contactado' or a.action<>'principal' then raise exception 'Ambas versiones deben ser saludos de WhatsApp de la misma acción.'; end if;
 if a.body ~* '(piso_candidato_1_inmobiliaria|\[calle o barrio\])' or b.body ~* '(piso_candidato_1_inmobiliaria|\[calle o barrio\])' then raise exception 'Editá la versión y reemplazá el marcador de ubicación por la variable Inmueble candidato.'; end if;
 if coalesce(p_control_intent,'') not in ('confirm_number','offer_demo') or coalesce(p_variant_intent,'') not in ('confirm_number','offer_demo') then raise exception 'Indicá qué pide cada saludo.'; end if;
 if (a.reply_intent is not null and a.reply_intent<>p_control_intent) or (b.reply_intent is not null and b.reply_intent<>p_variant_intent) then raise exception 'La intención elegida difiere de la guardada para esa versión.'; end if;
 update followup_versions set reply_intent=p_control_intent where id=a.id;
 update followup_versions set reply_intent=p_variant_intent where id=b.id;
 perform habita_followup_set_status(a.id,'active');
 perform habita_followup_set_status(b.id,'test');
 return b.id;
end $function$;
