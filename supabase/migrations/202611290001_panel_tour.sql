-- The panel's welcome tour (src/components/panel-tour.tsx): when this account
-- first saw it and which version, so it starts by itself only once, on any
-- device. Read and written only by /api/panel/recorrido (service role).
-- Without this migration the tour never starts by itself; «Ayuda → Volver a
-- ver el recorrido» still works. Idempotent: safe to run again.
alter table public.profiles add column if not exists panel_tour_seen_at timestamptz;
alter table public.profiles add column if not exists panel_tour_version integer;
