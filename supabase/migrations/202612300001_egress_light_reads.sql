-- Menos egreso de Supabase en las lecturas de la cola (Follow-up, Chapa Labs, Inmobiliarias).
-- No cambia datos. El código funciona igual con o sin esta migración: sin ella sigue leyendo
-- como antes (source_data completo y followup_agencies entera en cada recarga).

-- 1. followup_agencies: updated_at lo pone la base en cada update (como en agencies,
--    prospect_accounts y prospect_contacts), así se puede leer solo lo que cambió.
drop trigger if exists touch_updated_at on public.followup_agencies;
create trigger touch_updated_at before update on public.followup_agencies
 for each row execute function public.amobla_touch_updated_at();

-- El código lee followup_agencies de forma incremental solo si el trigger está.
create or replace function public.habita_followup_incremental_ready() returns boolean
 language sql stable security definer set search_path=public as $$
 select exists (select 1 from pg_trigger where tgname = 'touch_updated_at' and tgrelid = 'public.followup_agencies'::regclass and not tgisinternal)
$$;

-- 2. La cola solo usa dos datos de la hoja de prospección (source_data): su «Estado» y su
--    «Fecha envío». En vez de bajar source_data entero de cada cuenta en cada recarga, la base
--    devuelve esos dos, y solo de las cuentas que los tienen. source_data completo se sigue
--    leyendo al abrir una cuenta (habita_prospect_account).
--    Misma regla que sheetFacts() en src/lib/followup/server.ts: la clave sin tildes, mayúsculas
--    ni espacios de los bordes; el valor, texto no vacío.
create or replace function public.habita_followup_sheet_facts() returns jsonb
 language sql stable security definer set search_path=public as $$
 select coalesce(jsonb_agg(jsonb_build_object('agency_id', f.agency_id, 'status', f.status, 'sent_date', f.sent_date)), '[]'::jsonb)
 from (
  select pa.agency_id,
   (select btrim(e.value #>> '{}') from jsonb_each(pa.source_data) e
     where lower(btrim(translate(e.key, 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun'))) = 'estado'
       and jsonb_typeof(e.value) = 'string' and btrim(e.value #>> '{}') <> ''
     order by e.key limit 1) as status,
   (select btrim(e.value #>> '{}') from jsonb_each(pa.source_data) e
     where lower(btrim(translate(e.key, 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun'))) ~ '^fecha (de )?envio$'
       and jsonb_typeof(e.value) = 'string' and btrim(e.value #>> '{}') <> ''
     order by e.key limit 1) as sent_date
  from prospect_accounts pa
  where pa.stage not in ('lost', 'discarded') and pa.source_data <> '{}'::jsonb
 ) f
 where f.status is not null or f.sent_date is not null
$$;

-- 3. Prospectos (habita_prospect_pool): de source_data solo viajan las tres claves que usa el
--    ranking (variables() en src/lib/prospecting/pool.ts), no la fila entera de la planilla.
create or replace function public.habita_prospect_pool() returns jsonb
 language sql stable security definer set search_path=public as $$
 select jsonb_build_object(
  'profiles', coalesce((select jsonb_agg(to_jsonb(p)) from prospect_profiles p), '[]'),
  'extra', coalesce((select jsonb_agg(jsonb_build_object('account_id', pa.id, 'address', pa.address, 'source', pa.source,
     'source_data', case when pa.stage = 'pending' then coalesce((select jsonb_object_agg(e.key, e.value) from jsonb_each(pa.source_data) e
        where e.key in ('Propiedades publicadas (Argenprop)', 'Instagram', 'Perfil Argenprop')), '{}'::jsonb) else '{}'::jsonb end,
     'source_notes', case when pa.stage = 'pending' then pa.source_notes else null end)) from prospect_accounts pa), '[]')
 )
$$;

do $$ declare f text; begin
 foreach f in array array['habita_followup_incremental_ready()', 'habita_followup_sheet_facts()', 'habita_prospect_pool()'] loop
  execute format('revoke all on function public.%s from public, anon, authenticated', f);
  execute format('grant execute on function public.%s to service_role', f);
 end loop;
end $$;
