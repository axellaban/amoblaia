-- The greeting experiment uses the same active/test assignment as the follow-up queue.
alter table public.followup_versions add column if not exists reply_intent text
  check (reply_intent in ('confirm_number','offer_demo'));
create table if not exists public.followup_ab_runs (
 id uuid primary key default gen_random_uuid(),
 control_id uuid not null references public.followup_versions(id),
 variant_id uuid not null references public.followup_versions(id),
 started_at timestamptz not null default now(), ended_at timestamptz,
 check(control_id <> variant_id)
);
create unique index if not exists followup_ab_live_variant on public.followup_ab_runs(variant_id) where ended_at is null;
alter table public.followup_ab_runs enable row level security;
revoke all on public.followup_ab_runs from public,anon,authenticated;
grant select,insert,update on public.followup_ab_runs to service_role;

create or replace function public.habita_ab_track() returns trigger language plpgsql set search_path=public as $$
declare a uuid; b uuid;
begin
 if TG_OP='UPDATE' and old.status=new.status then return new; end if;
 if TG_OP='UPDATE' then
  update followup_ab_runs set ended_at=now() where ended_at is null and (control_id=new.id or variant_id=new.id);
 end if;
 select id into a from followup_versions where stage=new.stage and action=new.action and status='active';
 select id into b from followup_versions where stage=new.stage and action=new.action and status='test';
 if a is not null and b is not null then
  insert into followup_ab_runs(control_id,variant_id) values(a,b) on conflict do nothing;
 end if;
 return new;
end $$;
drop trigger if exists followup_ab_track on public.followup_versions;
create trigger followup_ab_track after insert or update of status on public.followup_versions for each row execute function public.habita_ab_track();
insert into public.followup_ab_runs(control_id,variant_id,started_at)
select a.id,b.id,greatest(a.status_at,b.status_at) from public.followup_versions a join public.followup_versions b using(stage,action)
where a.status='active' and b.status='test' on conflict do nothing;

create or replace function public.habita_ab_configure(p_actor uuid,p_control uuid,p_variant uuid,p_body text,p_control_intent text,p_variant_intent text,p_winner uuid)
returns uuid language plpgsql set search_path=public as $$
declare a followup_versions; b followup_versions; running uuid;
begin
 select * into strict a from followup_versions where id=p_control;
 perform pg_advisory_xact_lock(hashtext('followup:'||a.stage||':'||a.action));
 select * into strict a from followup_versions where id=p_control and status='active';
 select id into running from followup_versions where stage=a.stage and action=a.action and status='test';
 if p_winner is not null then
  if running is null or running is distinct from p_variant or p_winner not in (a.id,running) then raise exception 'La prueba cambió. Actualizá el panel.'; end if;
  if p_winner=a.id then perform habita_followup_set_status(running,'archived'); else perform habita_followup_set_status(running,'active'); end if;
  return p_winner;
 end if;
 if running is not null then raise exception 'Ya hay una prueba en curso.'; end if;
 if a.channel<>'whatsapp' or nullif(btrim(p_body),'') is null or length(p_body)>4000 or btrim(p_body)=btrim(a.body) then raise exception 'Ingresá un mensaje B diferente, de hasta 4000 caracteres.'; end if;
 if p_body ~ '(\[|\{)piso_candidato' then raise exception 'Usá {{inmueble_candidato}} para referirte al aviso.'; end if;
 if a.stage='no-contactado' and a.action='principal' then
  if coalesce(p_control_intent,'') not in ('confirm_number','offer_demo') or coalesce(p_variant_intent,'') not in ('confirm_number','offer_demo') then raise exception 'Elegí qué pide cada mensaje.'; end if;
  if a.reply_intent is not null and a.reply_intent<>p_control_intent then raise exception 'La versión activa ya tiene otra intención.'; end if;
  update followup_versions set reply_intent=p_control_intent where id=a.id;
 else p_variant_intent=null; end if;
 select * into b from habita_followup_create(p_actor,a.stage,a.channel,a.trigger_label,p_body,a.ctas,'test',a.action);
 update followup_versions set reply_intent=p_variant_intent,notes=a.notes where id=b.id;
 return b.id;
end $$;
revoke all on function public.habita_ab_configure(uuid,uuid,uuid,text,text,text,uuid) from public,anon,authenticated;
grant execute on function public.habita_ab_configure(uuid,uuid,uuid,text,text,text,uuid) to service_role;