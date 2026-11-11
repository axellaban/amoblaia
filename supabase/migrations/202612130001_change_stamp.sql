-- A cheap "did anything change?" for the team's panels.
--
-- The Follow-up queue and the Prospecting panel reload on a timer, and each
-- reload reads the whole commercial dataset (about 2 MB) out of Supabase. Most
-- of those reloads find nothing new. This function returns a short stamp that
-- changes whenever any row of any public table is inserted, updated or deleted
-- (from Postgres' own per-table write counters), so the server can answer
-- "unchanged" to a timed reload without reading the data again.
--
-- Read-only. Without this migration the panels work as before (every reload in full).
CREATE OR REPLACE FUNCTION public.habita_change_stamp()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
  select md5(coalesce(string_agg(relid::text || ':' || (n_tup_ins + n_tup_upd + n_tup_del)::text, ',' order by relid), ''))
    from pg_stat_user_tables
   where schemaname = 'public'
$$;

REVOKE ALL ON FUNCTION public.habita_change_stamp() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.habita_change_stamp() TO service_role;
COMMENT ON FUNCTION public.habita_change_stamp() IS 'Stamp that changes with any write to a public table; lets timed panel reloads skip re-reading unchanged data (server only).';
