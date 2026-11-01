// The panel's upcoming tools: in the sidebar like any section, each with its
// own page that says plainly it is not available yet and records who wants
// it (spec §2.1, §5). Client-safe: no server code.

export const FUTURE_FEATURES = ["tour_360", "planos", "redes", "api", "video"] as const;
export type FutureFeature = (typeof FUTURE_FEATURES)[number];

export type FutureFeatureInfo = {
  key: FutureFeature;
  /** The panel route: /panel/<slug>. */
  slug: string;
  title: string;
  /** What it will let the agency do, concretely. */
  description: string;
  benefits: string[];
};

export const FUTURE_FEATURE_INFO: Record<FutureFeature, FutureFeatureInfo> = {
  tour_360: {
    key: "tour_360",
    slug: "tour-360",
    title: "Tour 360",
    description:
      "Recorridos virtuales de tus propiedades a partir de fotos 360, para que tus clientes las exploren desde el celular antes de visitarlas.",
    benefits: ["Menos visitas de curiosos", "Un enlace para compartir por WhatsApp", "Se integra a la ficha de la propiedad"],
  },
  planos: {
    key: "planos",
    slug: "planos",
    title: "Planos",
    description: "Planos claros de cada propiedad a partir de un croquis o una foto del plano, listos para sumar a la ficha y a tus publicaciones.",
    benefits: ["Medidas y ambientes a la vista", "Mismo estilo en todas tus fichas", "Descargable para portales"],
  },
  redes: {
    key: "redes",
    slug: "redes",
    title: "Redes",
    description: "Publicaciones e historias para Instagram y Facebook armadas con las fotos y los datos reales de cada propiedad.",
    benefits: ["Formatos para feed e historias", "Con tu logo y tu contacto", "Textos a partir de la ficha"],
  },
  api: {
    key: "api",
    slug: "api",
    title: "API",
    description: "Conectá Habita con tu CRM o tu sitio para crear fichas y ambientaciones de forma automática.",
    benefits: ["Sincronización con tu CRM", "Fichas y fotos sin cargarlas a mano", "Documentación y soporte técnico"],
  },
  video: {
    key: "video",
    slug: "video",
    title: "Video",
    description:
      "Videos de tus propiedades a partir de sus fotos: un montaje con transiciones o fotos en movimiento creadas con IA, en formato vertical u horizontal.",
    benefits: ["Formatos 9:16 y 16:9", "Con los datos reales de la propiedad", "Costo visible antes de generar"],
  },
};

export const isFutureFeature = (v: unknown): v is FutureFeature => typeof v === "string" && (FUTURE_FEATURES as readonly string[]).includes(v);
