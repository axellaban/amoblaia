-- Independent demand signal for commercial products.
-- No buyer names, phone numbers, messages or real lead content.
-- Only the authenticated agency member may express their own interest via the server API.
CREATE TABLE IF NOT EXISTS public.commercial_product_interest (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES public.agencies(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  product_key text NOT NULL CHECK (product_key IN ('consultas_ia','crm_inteligente')),
  volume_band text NOT NULL CHECK (volume_band IN ('1-10','11-30','31-100','100+')),
  primary_pain text NOT NULL CHECK (primary_pain IN ('responder_fuera_de_horario','calificar_leads','agendar_visitas','seguimiento','priorizar_oportunidades','medir_conversion')),
  readiness text NOT NULL CHECK (readiness IN ('esta_semana','este_mes','mas_adelante')),
  source_surface text NOT NULL DEFAULT 'commercial_workspace',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(agency_id,user_id,product_key)
);
CREATE INDEX IF NOT EXISTS commercial_product_interest_product_created_idx
  ON public.commercial_product_interest(product_key,created_at DESC);
ALTER TABLE public.commercial_product_interest ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.commercial_product_interest FROM anon, authenticated;
COMMENT ON TABLE public.commercial_product_interest IS 'Qualified interest in the Habita commercial workspace products; private to the server service role.';
