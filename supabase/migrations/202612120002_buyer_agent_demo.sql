-- «Asistente de la propiedad» in the agency's own demo (Paso 2 of the commercial
-- layer exploration). Re-runnable. Without it, the block never shows (the
-- general test reads as off) and nothing else changes.

-- 1. The general test: one row, OFF by default. The team turns it on in
--    /admin/inmobiliarias. share = % of agencies (by a stable hash of their id)
--    that see the block while it is on; the rest are the control group.
CREATE TABLE IF NOT EXISTS public.habita_experiment_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  buyer_agent_enabled boolean NOT NULL DEFAULT false,
  buyer_agent_share smallint NOT NULL DEFAULT 50 CHECK (buyer_agent_share BETWEEN 0 AND 100),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL
);
INSERT INTO public.habita_experiment_settings (id) VALUES (true) ON CONFLICT (id) DO NOTHING;
ALTER TABLE public.habita_experiment_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.habita_experiment_settings FROM anon, authenticated;
COMMENT ON TABLE public.habita_experiment_settings IS 'Product experiments switched by the team (server only). buyer_agent_*: the property assistant in the agency demo, off by default.';

-- 2. Access requests from the demo, before the agency has an account: no user,
--    the demo it came from, and no form (the three answers stay for the panel's form).
ALTER TABLE public.commercial_product_interest ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE public.commercial_product_interest ALTER COLUMN volume_band DROP NOT NULL;
ALTER TABLE public.commercial_product_interest ALTER COLUMN primary_pain DROP NOT NULL;
ALTER TABLE public.commercial_product_interest ALTER COLUMN readiness DROP NOT NULL;
ALTER TABLE public.commercial_product_interest ADD COLUMN IF NOT EXISTS demo_id uuid NULL REFERENCES public.demos(id) ON DELETE SET NULL;

ALTER TABLE public.commercial_product_interest DROP CONSTRAINT IF EXISTS commercial_product_interest_product_key_check;
ALTER TABLE public.commercial_product_interest ADD CONSTRAINT commercial_product_interest_product_key_check
  CHECK (product_key IN ('consultas_ia','crm_inteligente','asistente_propiedad'));

-- A row without a user only comes from the demo, and always names it.
ALTER TABLE public.commercial_product_interest DROP CONSTRAINT IF EXISTS commercial_product_interest_origin_check;
ALTER TABLE public.commercial_product_interest ADD CONSTRAINT commercial_product_interest_origin_check
  CHECK (user_id IS NOT NULL OR (source_surface = 'demo_owner' AND demo_id IS NOT NULL));

-- One request per agency and product from the demo (the panel keeps one per user).
CREATE UNIQUE INDEX IF NOT EXISTS commercial_product_interest_demo_once
  ON public.commercial_product_interest (agency_id, product_key) WHERE user_id IS NULL;
