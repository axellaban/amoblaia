alter table public.followup_agencies add column catalog_situation text references public.followup_state_catalog(key);
alter table public.followup_replies add column catalog_situation text references public.followup_state_catalog(key);
alter table public.followup_rules add column catalog_situation text references public.followup_state_catalog(key);
