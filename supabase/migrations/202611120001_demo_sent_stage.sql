-- WhatsApp sending of commercial demos.
-- * demos.sent_at: when the team sent the demo (or marked it sent by hand). Null = "Sin enviar".
-- * demos.message_template: this demo's own message; null uses the global one.
-- * demo_message_settings: the global message template (a single row, id = 1).
-- * A visit ("Ingresó") also marks the demo as sent when it was not, so the
--   follow-up never shows a visited demo as unsent.
-- Additive and idempotent: safe to run again. See docs/DEMOS_COMERCIALES.md.
begin;

alter table public.demos add column if not exists sent_at timestamptz;
alter table public.demos add column if not exists message_template text
  check (message_template is null or length(message_template) <= 1000);

create table if not exists public.demo_message_settings (
 id smallint primary key default 1 check (id = 1),
 template text not null check (length(template) between 1 and 1000),
 updated_at timestamptz not null default now()
);
alter table public.demo_message_settings enable row level security;
revoke all on public.demo_message_settings from anon, authenticated;

-- Same as before, plus: the first visit marks the demo as sent.
create or replace function public.habita_record_demo_activity(p_demo uuid, p_visitor text, p_kind text) returns void language plpgsql security definer set search_path=public as $$
declare lvl smallint;
begin
 lvl := case p_kind when 'visita' then 1 when 'interaccion' then 2 when 'descarga' then 2 when 'generacion' then 3 when 'panel' then 4 when 'compra' then 5 end;
 if lvl is null or p_visitor is null or length(btrim(p_visitor)) not between 1 and 80 then raise exception 'INVALID_ACTIVITY'; end if;
 insert into demo_activity(demo_id, visitor, kind, level) values(p_demo, p_visitor, p_kind, lvl) on conflict (demo_id, visitor, kind) do nothing;
 if not found then return; end if;
 update demos set
  activity_level = greatest(activity_level, lvl),
  activity_at = now(),
  activity_visitors = activity_visitors + (case when p_kind = 'visita' then 1 else 0 end),
  sent_at = case when p_kind = 'visita' then coalesce(sent_at, now()) else sent_at end
 where id = p_demo;
end $$;

commit;
