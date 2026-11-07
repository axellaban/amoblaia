-- Follow-up, segunda parte (docs/FOLLOWUP.md):
--
-- 1. Las versiones se editan. Siguen sin borrarse y sin cambiar de etapa ni de
--    número; `edited_at` dice cuándo cambió el texto, así se sabe que sus números
--    juntan el texto anterior y el nuevo. Para comparar textos, una versión nueva.
-- 2. Observaciones de cada versión (`notes`): lo que la extensión lee debajo del
--    mensaje antes de ejecutarlo.
-- 3. followup_agencies: lo que Follow-up guarda de cada inmobiliaria.
--    - La etapa corregida a mano (`stage_override`): la extensión o el equipo la
--      revisan al ejecutar. Vale mientras el embudo siga diciendo lo mismo que
--      cuando se corrigió (`override_step`); si después pasa algo real (envía,
--      visita, crea su cuenta), manda el embudo. «fuera»: no va en Follow-up.
--    - Dirección, zona y score de las inmobiliarias agregadas a mano, que no
--      tienen cuenta de prospección (las que la tienen usan los de esa cuenta).
-- 4. followup_script: el guion que lee la extensión (Follow-up → Script).
--
-- Solo los usan las rutas del servidor (service role): RLS sin políticas.
-- Aditiva e idempotente.
begin;

alter table public.followup_versions add column if not exists notes text not null default '' check (length(notes) <= 4000);
alter table public.followup_versions add column if not exists edited_at timestamptz;

create or replace function public.habita_followup_version_frozen() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'FOLLOWUP_VERSION_FROZEN';
  end if;
  if new.stage is distinct from old.stage or new.version is distinct from old.version
     or new.created_by is distinct from old.created_by or new.created_at is distinct from old.created_at then
    raise exception 'FOLLOWUP_VERSION_FROZEN';
  end if;
  return new;
end $$;

create table if not exists public.followup_agencies (
  agency_id uuid primary key references public.agencies(id) on delete cascade,
  stage_override text check (stage_override in ('no-contactado', 'no-responde', 'sin-demo', 'sin-enviar', 'no-abrio', 'sin-interaccion', 'sin-cuenta', 'sin-uso', 'sin-suscripcion', 'fuera')),
  override_step integer check (override_step between -1 and 8),
  address text check (address is null or length(address) <= 200),
  zone text check (zone is null or length(zone) <= 120),
  score numeric(8, 2) check (score is null or score between 0 and 100),
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  check ((stage_override is null) = (override_step is null))
);

create table if not exists public.followup_script (
  id smallint primary key default 1 check (id = 1),
  body text not null default '' check (length(body) <= 20000),
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);
insert into public.followup_script (id) values (1) on conflict (id) do nothing;

alter table public.followup_agencies enable row level security;
alter table public.followup_script enable row level security;
revoke all on public.followup_agencies from anon, authenticated;
revoke all on public.followup_script from anon, authenticated;

commit;
