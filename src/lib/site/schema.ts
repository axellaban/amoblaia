// The agency's website as built in Panel → Sitio web: theme, header and
// footer, pages and their sections. Pure and safe for the browser: the
// editor, the public renderer and the server's validation share it.
//
// Every section type declares its fields once (SECTIONS). That list drives
// the editor's inspector and the server's normalization, so whatever the
// editor can produce is exactly what the server accepts and the site shows.

export const SITE_VERSION = 1;

/* ─────────────────────────── Fields ─────────────────────────── */

export type Option = readonly [value: string, label: string];
type Base = { key: string; label: string; help?: string };
export type Field =
  | (Base & { kind: "text"; max?: number; placeholder?: string })
  | (Base & { kind: "textarea"; max?: number; placeholder?: string; rows?: number })
  | (Base & { kind: "link"; placeholder?: string })
  | (Base & { kind: "image" })
  | (Base & { kind: "color" })
  | (Base & { kind: "select"; options: readonly Option[] })
  | (Base & { kind: "toggle" })
  | (Base & { kind: "number"; min: number; max: number; step?: number; unit?: string })
  | (Base & { kind: "icon" })
  | (Base & { kind: "list"; itemLabel: string; fields: readonly Field[]; max: number; titleKey: string });

export type Props = Record<string, unknown>;

export const ICONS = [
  ["home", "Casa"],
  ["building", "Edificio"],
  ["key", "Llave"],
  ["search", "Búsqueda"],
  ["handshake", "Acuerdo"],
  ["chart", "Tendencia"],
  ["shield", "Seguridad"],
  ["camera", "Fotos"],
  ["sparkles", "IA / destacado"],
  ["map", "Mapa"],
  ["phone", "Teléfono"],
  ["file", "Documentos"],
  ["calculator", "Tasación"],
  ["users", "Equipo"],
  ["star", "Estrella"],
  ["heart", "Corazón"],
  ["clock", "Reloj"],
  ["award", "Premio"],
  ["landmark", "Banco / crédito"],
  ["scale", "Legal"],
] as const satisfies readonly Option[];
export type IconId = (typeof ICONS)[number][0];

/* ─────────────────────────── Theme ─────────────────────────── */

export const FONTS = [
  ["manrope", "Manrope (moderna)"],
  ["inter", "Inter (neutra)"],
  ["montserrat", "Montserrat (geométrica)"],
  ["poppins", "Poppins (amigable)"],
  ["dmsans", "DM Sans (limpia)"],
  ["playfair", "Playfair Display (elegante)"],
  ["lora", "Lora (clásica)"],
  ["cormorant", "Cormorant (lujo)"],
] as const satisfies readonly Option[];
export type FontId = (typeof FONTS)[number][0];
export const SERIF_FONTS: readonly FontId[] = ["playfair", "lora", "cormorant"];

export type SiteTheme = {
  primary: string;
  accent: string;
  background: string;
  surface: string;
  text: string;
  headingFont: FontId;
  bodyFont: FontId;
  radius: "none" | "soft" | "round";
  buttons: "solid" | "outline" | "pill";
  width: "normal" | "wide";
  headingCase: "normal" | "upper";
};

export type SiteHeader = {
  style: "light" | "dark" | "brand" | "transparent";
  layout: "left" | "center";
  sticky: boolean;
  ctaLabel: string;
  ctaLink: string;
  showPhone: boolean;
};
export type SiteFooter = {
  style: "dark" | "light" | "brand";
  about: string;
  showPages: boolean;
  showContact: boolean;
  showSocial: boolean;
  legal: string;
};
export type SiteSettings = {
  tagline: string;
  phone: string;
  whatsapp: string;
  email: string;
  address: string;
  hours: string;
  license: string;
  instagram: string;
  facebook: string;
  linkedin: string;
  youtube: string;
  tiktok: string;
  seoTitle: string;
  seoDescription: string;
  shareImage: string;
  indexable: boolean;
  ga4: string;
  metaPixel: string;
  whatsappButton: boolean;
  whatsappMessage: string;
  announcement: string;
  announcementLink: string;
};

export type SectionType =
  | "hero"
  | "search"
  | "featured"
  | "listings"
  | "about"
  | "services"
  | "stats"
  | "steps"
  | "testimonials"
  | "team"
  | "zones"
  | "cta"
  | "valuation"
  | "contact"
  | "map"
  | "faq"
  | "text"
  | "gallery"
  | "video"
  | "logos"
  | "newsletter"
  | "staging";

export type Section = {
  id: string;
  type: SectionType;
  hidden?: boolean;
  props: Props;
};
export type SitePage = {
  id: string;
  title: string;
  /** "" is the home page. Otherwise 2 to 19 characters, so it never collides with a property's link (20+). */
  slug: string;
  nav: boolean;
  seoTitle: string;
  seoDescription: string;
  sections: Section[];
};
export type SiteDoc = {
  version: number;
  template: TemplateId;
  theme: SiteTheme;
  header: SiteHeader;
  footer: SiteFooter;
  settings: SiteSettings;
  pages: SitePage[];
};

/* ─────────────────────────── Sections ─────────────────────────── */

const BG_OPTIONS = [
  ["default", "Fondo del sitio"],
  ["surface", "Fondo alternativo"],
  ["brand", "Color de marca"],
  ["dark", "Oscuro"],
] as const;
const SPACE_OPTIONS = [
  ["compact", "Compacto"],
  ["normal", "Normal"],
  ["roomy", "Amplio"],
] as const;
const OPERATION_OPTIONS = [
  ["", "Todas"],
  ["venta", "Venta"],
  ["alquiler", "Alquiler"],
  ["temporario", "Alquiler temporario"],
] as const;
const ALIGN = [
  ["left", "Izquierda"],
  ["center", "Centrado"],
] as const;

/** Fields every section has: its background, spacing and anchor (#contacto). */
export const COMMON_FIELDS: readonly Field[] = [
  { key: "bg", label: "Fondo", kind: "select", options: BG_OPTIONS },
  { key: "space", label: "Espaciado", kind: "select", options: SPACE_OPTIONS },
  { key: "anchor", label: "Ancla (para enlaces #)", kind: "text", max: 30, placeholder: "contacto", help: "Para llevar a esta sección con un botón: #contacto." },
];

const heading = (max = 120): Field[] => [
  { key: "eyebrow", label: "Antetítulo", kind: "text", max: 60 },
  { key: "title", label: "Título", kind: "text", max },
  { key: "subtitle", label: "Bajada", kind: "textarea", max: 320, rows: 2 },
];
const button = (prefix = "button", label = "Botón"): Field[] => [
  { key: `${prefix}Label`, label: `${label}: texto`, kind: "text", max: 40 },
  { key: `${prefix}Link`, label: `${label}: destino`, kind: "link" },
];

export type SectionGroup = "Portada" | "Propiedades" | "Empresa" | "Confianza" | "Contacto" | "Contenido";
export type SectionDef = {
  label: string;
  description: string;
  group: SectionGroup;
  fields: readonly Field[];
  defaults: Props;
  /** Only one per page makes sense (the catalog). */
  single?: boolean;
};

export const SECTIONS: Record<SectionType, SectionDef> = {
  hero: {
    label: "Portada",
    description: "Imagen grande con título, buscador y botones.",
    group: "Portada",
    fields: [
      {
        key: "variant",
        label: "Diseño",
        kind: "select",
        options: [
          ["image", "Imagen de fondo"],
          ["split", "Texto e imagen"],
          ["minimal", "Solo texto"],
        ],
      },
      ...heading(140),
      { key: "image", label: "Imagen", kind: "image", help: "Si no subís una, se usa la foto de una de tus propiedades." },
      { key: "overlay", label: "Oscurecer la imagen", kind: "number", min: 0, max: 85, step: 5, unit: "%" },
      {
        key: "height",
        label: "Alto",
        kind: "select",
        options: [
          ["s", "Bajo"],
          ["m", "Medio"],
          ["l", "Alto"],
          ["full", "Pantalla completa"],
        ],
      },
      { key: "align", label: "Alineación", kind: "select", options: ALIGN },
      { key: "search", label: "Mostrar buscador de propiedades", kind: "toggle" },
      ...button("button", "Botón principal"),
      ...button("second", "Botón secundario"),
    ],
    defaults: {
      variant: "image",
      eyebrow: "",
      title: "Encontrá tu próximo hogar",
      subtitle: "Propiedades en venta y alquiler, con fotos reales y ambientaciones para imaginar cada espacio.",
      image: "",
      overlay: 45,
      height: "l",
      align: "center",
      search: true,
      buttonLabel: "",
      buttonLink: "",
      secondLabel: "",
      secondLink: "",
      bg: "default",
      space: "normal",
    },
  },
  search: {
    label: "Buscador",
    description: "Barra para buscar por operación, tipo y zona.",
    group: "Propiedades",
    fields: [...heading(), { key: "align", label: "Alineación", kind: "select", options: ALIGN }],
    defaults: { eyebrow: "", title: "¿Qué estás buscando?", subtitle: "", align: "center", bg: "surface", space: "compact" },
  },
  featured: {
    label: "Propiedades destacadas",
    description: "Las últimas o mejores propiedades, en grilla o carrusel.",
    group: "Propiedades",
    fields: [
      ...heading(),
      { key: "operation", label: "Operación", kind: "select", options: OPERATION_OPTIONS },
      { key: "count", label: "Cantidad", kind: "number", min: 2, max: 12 },
      {
        key: "layout",
        label: "Diseño",
        kind: "select",
        options: [
          ["grid", "Grilla"],
          ["carousel", "Carrusel"],
        ],
      },
      { key: "onlyStaged", label: "Solo con ambientación IA", kind: "toggle" },
      ...button("button", "Botón"),
    ],
    defaults: {
      eyebrow: "Destacadas",
      title: "Propiedades destacadas",
      subtitle: "",
      operation: "",
      count: 6,
      layout: "grid",
      onlyStaged: false,
      buttonLabel: "Ver todas las propiedades",
      buttonLink: "/propiedades",
      bg: "default",
      space: "normal",
    },
  },
  listings: {
    label: "Catálogo con filtros",
    description: "Todas tus propiedades con buscador, filtros y orden.",
    group: "Propiedades",
    single: true,
    fields: [
      ...heading(),
      { key: "operation", label: "Mostrar solo", kind: "select", options: OPERATION_OPTIONS },
      { key: "filters", label: "Mostrar filtros", kind: "toggle" },
      { key: "perPage", label: "Propiedades por página", kind: "number", min: 6, max: 48, step: 3 },
      {
        key: "columns",
        label: "Columnas",
        kind: "select",
        options: [
          ["2", "2"],
          ["3", "3"],
          ["4", "4"],
        ],
      },
    ],
    defaults: { eyebrow: "", title: "Propiedades", subtitle: "", operation: "", filters: true, perPage: 12, columns: "3", bg: "default", space: "normal" },
  },
  about: {
    label: "Sobre nosotros",
    description: "Texto con imagen y puntos fuertes.",
    group: "Empresa",
    fields: [
      ...heading(),
      { key: "body", label: "Texto", kind: "textarea", max: 2000, rows: 6 },
      { key: "image", label: "Imagen", kind: "image" },
      {
        key: "imageSide",
        label: "Imagen a la",
        kind: "select",
        options: [
          ["right", "Derecha"],
          ["left", "Izquierda"],
        ],
      },
      { key: "points", label: "Puntos fuertes", kind: "list", itemLabel: "Punto", max: 8, titleKey: "text", fields: [{ key: "text", label: "Texto", kind: "text", max: 120 }] },
      ...button(),
    ],
    defaults: {
      eyebrow: "Quiénes somos",
      title: "Una inmobiliaria cerca tuyo",
      subtitle: "",
      body: "Acompañamos a familias e inversores en cada paso: tasación, venta, alquiler y administración. Conocemos el barrio, el mercado y los tiempos de cada operación.",
      image: "/ejemplos/living-scandinavian.webp",
      imageSide: "right",
      points: [{ text: "Tasaciones en 48 horas" }, { text: "Fotos profesionales y ambientaciones con IA" }, { text: "Asesoramiento legal y contable" }],
      buttonLabel: "Conocenos",
      buttonLink: "/nosotros",
      bg: "surface",
      space: "normal",
    },
  },
  services: {
    label: "Servicios",
    description: "Tarjetas con ícono, título y texto.",
    group: "Empresa",
    fields: [
      ...heading(),
      {
        key: "columns",
        label: "Columnas",
        kind: "select",
        options: [
          ["2", "2"],
          ["3", "3"],
          ["4", "4"],
        ],
      },
      {
        key: "items",
        label: "Servicios",
        kind: "list",
        itemLabel: "Servicio",
        max: 12,
        titleKey: "title",
        fields: [
          { key: "icon", label: "Ícono", kind: "icon" },
          { key: "title", label: "Título", kind: "text", max: 60 },
          { key: "text", label: "Texto", kind: "textarea", max: 300, rows: 3 },
          { key: "link", label: "Enlace (opcional)", kind: "link" },
        ],
      },
    ],
    defaults: {
      eyebrow: "Servicios",
      title: "Todo lo que necesitás, en un solo lugar",
      subtitle: "",
      columns: "3",
      items: [
        { icon: "key", title: "Venta", text: "Publicamos tu propiedad donde están los compradores y te acompañamos hasta la escritura.", link: "" },
        { icon: "home", title: "Alquiler", text: "Buscamos inquilinos con garantía, armamos el contrato y gestionamos la entrega.", link: "" },
        { icon: "calculator", title: "Tasaciones", text: "Te decimos cuánto vale tu propiedad hoy, con datos reales del mercado.", link: "/tasaciones" },
        { icon: "sparkles", title: "Ambientación con IA", text: "Mostramos cómo podría verse cada espacio amueblado para que se venda antes.", link: "" },
        { icon: "file", title: "Administración", text: "Cobramos alquileres, pagamos expensas e impuestos y te rendimos cuentas cada mes.", link: "" },
        { icon: "landmark", title: "Créditos hipotecarios", text: "Te orientamos para comprar con crédito y coordinamos con el banco.", link: "" },
      ],
      bg: "default",
      space: "normal",
    },
  },
  stats: {
    label: "Números",
    description: "Cifras que generan confianza.",
    group: "Confianza",
    fields: [
      ...heading(),
      {
        key: "items",
        label: "Números",
        kind: "list",
        itemLabel: "Número",
        max: 6,
        titleKey: "value",
        fields: [
          { key: "value", label: "Valor", kind: "text", max: 16, placeholder: "+20" },
          { key: "label", label: "Descripción", kind: "text", max: 60 },
        ],
      },
    ],
    defaults: {
      eyebrow: "",
      title: "",
      subtitle: "",
      items: [
        { value: "+20", label: "años en el mercado" },
        { value: "+1.500", label: "operaciones cerradas" },
        { value: "98%", label: "clientes que nos recomiendan" },
        { value: "48 h", label: "para tu tasación" },
      ],
      bg: "brand",
      space: "compact",
    },
  },
  steps: {
    label: "Cómo trabajamos",
    description: "Pasos numerados de un proceso.",
    group: "Empresa",
    fields: [
      ...heading(),
      {
        key: "items",
        label: "Pasos",
        kind: "list",
        itemLabel: "Paso",
        max: 8,
        titleKey: "title",
        fields: [
          { key: "title", label: "Título", kind: "text", max: 60 },
          { key: "text", label: "Texto", kind: "textarea", max: 240, rows: 3 },
        ],
      },
    ],
    defaults: {
      eyebrow: "Paso a paso",
      title: "Cómo vendemos tu propiedad",
      subtitle: "",
      items: [
        { title: "Tasación", text: "Visitamos la propiedad y te damos un valor de mercado realista." },
        { title: "Producción", text: "Fotos, plano y ambientaciones con IA para que se destaque." },
        { title: "Difusión", text: "La publicamos en portales, redes y en nuestra base de compradores." },
        { title: "Cierre", text: "Negociamos por vos y te acompañamos hasta la escritura." },
      ],
      bg: "default",
      space: "normal",
    },
  },
  testimonials: {
    label: "Testimonios",
    description: "Lo que dicen tus clientes.",
    group: "Confianza",
    fields: [
      ...heading(),
      {
        key: "items",
        label: "Testimonios",
        kind: "list",
        itemLabel: "Testimonio",
        max: 12,
        titleKey: "name",
        fields: [
          { key: "quote", label: "Testimonio", kind: "textarea", max: 500, rows: 4 },
          { key: "name", label: "Nombre", kind: "text", max: 60 },
          { key: "role", label: "Detalle", kind: "text", max: 80, placeholder: "Vendió su departamento en Palermo" },
          { key: "rating", label: "Estrellas", kind: "number", min: 0, max: 5 },
        ],
      },
    ],
    defaults: {
      eyebrow: "Testimonios",
      title: "Lo que dicen nuestros clientes",
      subtitle: "",
      items: [
        { quote: "Vendimos en menos de dos meses. Nos explicaron cada paso y siempre respondieron rápido.", name: "Laura M.", role: "Vendió su casa", rating: 5 },
        { quote: "Las fotos amuebladas hicieron la diferencia: llegaron muchas más consultas.", name: "Martín G.", role: "Propietario", rating: 5 },
        { quote: "Encontramos el departamento ideal para alquilar sin vueltas. Muy recomendables.", name: "Sofía y Pablo", role: "Inquilinos", rating: 5 },
      ],
      bg: "surface",
      space: "normal",
    },
  },
  team: {
    label: "Equipo",
    description: "Agentes con foto, rol y contacto.",
    group: "Empresa",
    fields: [
      ...heading(),
      {
        key: "items",
        label: "Personas",
        kind: "list",
        itemLabel: "Persona",
        max: 24,
        titleKey: "name",
        fields: [
          { key: "photo", label: "Foto", kind: "image" },
          { key: "name", label: "Nombre", kind: "text", max: 60 },
          { key: "role", label: "Rol", kind: "text", max: 60 },
          { key: "license", label: "Matrícula", kind: "text", max: 60 },
          { key: "whatsapp", label: "WhatsApp", kind: "text", max: 30 },
          { key: "email", label: "Email", kind: "text", max: 120 },
        ],
      },
    ],
    defaults: {
      eyebrow: "Equipo",
      title: "Las personas detrás de cada operación",
      subtitle: "",
      items: [
        { photo: "", name: "Nombre Apellido", role: "Martillero y corredor público", license: "", whatsapp: "", email: "" },
        { photo: "", name: "Nombre Apellido", role: "Asesora comercial", license: "", whatsapp: "", email: "" },
        { photo: "", name: "Nombre Apellido", role: "Administración de alquileres", license: "", whatsapp: "", email: "" },
      ],
      bg: "default",
      space: "normal",
    },
  },
  zones: {
    label: "Barrios y zonas",
    description: "Tarjetas que abren el catálogo filtrado por zona.",
    group: "Propiedades",
    fields: [
      ...heading(),
      {
        key: "items",
        label: "Zonas",
        kind: "list",
        itemLabel: "Zona",
        max: 12,
        titleKey: "name",
        fields: [
          { key: "name", label: "Nombre", kind: "text", max: 60 },
          { key: "image", label: "Imagen", kind: "image" },
          { key: "query", label: "Buscar (opcional)", kind: "text", max: 60, help: "Lo que se busca en el catálogo. Si está vacío, el nombre." },
        ],
      },
    ],
    defaults: {
      eyebrow: "Zonas",
      title: "Buscá por barrio",
      subtitle: "",
      items: [
        { name: "Centro", image: "/ejemplos/living-modern.webp", query: "" },
        { name: "Zona norte", image: "/ejemplos/dining-scandinavian.webp", query: "" },
        { name: "Barrios cerrados", image: "/ejemplos/kitchen-farmhouse.webp", query: "" },
      ],
      bg: "default",
      space: "normal",
    },
  },
  cta: {
    label: "Llamado a la acción",
    description: "Banner con título y botón.",
    group: "Contacto",
    fields: [
      ...heading(),
      { key: "image", label: "Imagen de fondo (opcional)", kind: "image" },
      { key: "align", label: "Alineación", kind: "select", options: ALIGN },
      ...button("button", "Botón principal"),
      ...button("second", "Botón secundario"),
    ],
    defaults: {
      eyebrow: "",
      title: "¿Querés vender o alquilar tu propiedad?",
      subtitle: "Te decimos cuánto vale y cómo publicarla para que se mueva rápido.",
      image: "",
      align: "center",
      buttonLabel: "Pedir tasación",
      buttonLink: "/tasaciones",
      secondLabel: "Escribinos por WhatsApp",
      secondLink: "wa:",
      bg: "brand",
      space: "normal",
    },
  },
  valuation: {
    label: "Formulario de tasación",
    description: "Pedido de tasación con datos de la propiedad.",
    group: "Contacto",
    fields: [
      ...heading(),
      { key: "points", label: "Beneficios", kind: "list", itemLabel: "Beneficio", max: 6, titleKey: "text", fields: [{ key: "text", label: "Texto", kind: "text", max: 120 }] },
      { key: "submitLabel", label: "Texto del botón", kind: "text", max: 40 },
      { key: "success", label: "Mensaje al enviar", kind: "text", max: 200 },
    ],
    defaults: {
      eyebrow: "Tasaciones",
      title: "¿Cuánto vale tu propiedad?",
      subtitle: "Completá los datos y un asesor te contacta para coordinar la visita.",
      points: [{ text: "Sin costo ni compromiso" }, { text: "Valor basado en operaciones reales" }, { text: "Respuesta en 48 horas" }],
      submitLabel: "Pedir tasación",
      success: "¡Gracias! Te contactamos a la brevedad.",
      bg: "surface",
      space: "normal",
    },
  },
  contact: {
    label: "Contacto",
    description: "Formulario, datos de contacto y mapa.",
    group: "Contacto",
    fields: [
      ...heading(),
      { key: "form", label: "Mostrar formulario", kind: "toggle" },
      { key: "info", label: "Mostrar datos de contacto", kind: "toggle" },
      { key: "map", label: "Mostrar mapa", kind: "toggle" },
      { key: "submitLabel", label: "Texto del botón", kind: "text", max: 40 },
      { key: "success", label: "Mensaje al enviar", kind: "text", max: 200 },
    ],
    defaults: {
      eyebrow: "Contacto",
      title: "Hablemos",
      subtitle: "Dejanos tu consulta y te respondemos en el día.",
      form: true,
      info: true,
      map: false,
      submitLabel: "Enviar consulta",
      success: "¡Gracias! Recibimos tu consulta y te respondemos a la brevedad.",
      bg: "default",
      space: "normal",
      anchor: "contacto",
    },
  },
  map: {
    label: "Mapa",
    description: "Mapa de Google con la dirección de la oficina.",
    group: "Contacto",
    fields: [
      ...heading(),
      { key: "query", label: "Dirección", kind: "text", max: 200, help: "Si está vacío, la dirección de Ajustes." },
      {
        key: "height",
        label: "Alto",
        kind: "select",
        options: [
          ["s", "Bajo"],
          ["m", "Medio"],
          ["l", "Alto"],
        ],
      },
    ],
    defaults: { eyebrow: "", title: "Dónde estamos", subtitle: "", query: "", height: "m", bg: "default", space: "normal" },
  },
  faq: {
    label: "Preguntas frecuentes",
    description: "Preguntas y respuestas desplegables.",
    group: "Contenido",
    fields: [
      ...heading(),
      {
        key: "items",
        label: "Preguntas",
        kind: "list",
        itemLabel: "Pregunta",
        max: 20,
        titleKey: "q",
        fields: [
          { key: "q", label: "Pregunta", kind: "text", max: 160 },
          { key: "a", label: "Respuesta", kind: "textarea", max: 1200, rows: 4 },
        ],
      },
    ],
    defaults: {
      eyebrow: "Preguntas frecuentes",
      title: "Lo que más nos preguntan",
      subtitle: "",
      items: [
        { q: "¿Cuánto cobran de comisión?", a: "La comisión depende de la operación y de la jurisdicción. Te la informamos por escrito antes de empezar." },
        { q: "¿La tasación tiene costo?", a: "No. La tasación para vender o alquilar con nosotros es sin cargo." },
        { q: "¿Qué son las ambientaciones con IA?", a: "Son imágenes ilustrativas que muestran cómo podría verse un ambiente amueblado. Siempre publicamos también la foto original." },
      ],
      bg: "default",
      space: "normal",
    },
  },
  text: {
    label: "Texto",
    description: "Título y párrafos libres.",
    group: "Contenido",
    fields: [
      ...heading(),
      { key: "body", label: "Texto", kind: "textarea", max: 6000, rows: 10, help: "Dejá una línea en blanco entre párrafos. **negrita** para destacar." },
      { key: "align", label: "Alineación", kind: "select", options: ALIGN },
      ...button(),
    ],
    defaults: { eyebrow: "", title: "Título", subtitle: "", body: "Escribí acá tu texto.", align: "left", buttonLabel: "", buttonLink: "", bg: "default", space: "normal" },
  },
  gallery: {
    label: "Galería",
    description: "Grilla de imágenes con epígrafe.",
    group: "Contenido",
    fields: [
      ...heading(),
      {
        key: "columns",
        label: "Columnas",
        kind: "select",
        options: [
          ["2", "2"],
          ["3", "3"],
          ["4", "4"],
        ],
      },
      {
        key: "items",
        label: "Imágenes",
        kind: "list",
        itemLabel: "Imagen",
        max: 24,
        titleKey: "caption",
        fields: [
          { key: "image", label: "Imagen", kind: "image" },
          { key: "caption", label: "Epígrafe", kind: "text", max: 120 },
        ],
      },
    ],
    defaults: {
      eyebrow: "",
      title: "Nuestra oficina",
      subtitle: "",
      columns: "3",
      items: [
        { image: "/ejemplos/office-classic.webp", caption: "" },
        { image: "/ejemplos/living-midcentury.webp", caption: "" },
        { image: "/ejemplos/dining-modern.webp", caption: "" },
      ],
      bg: "default",
      space: "normal",
    },
  },
  video: {
    label: "Video",
    description: "Video de YouTube o Vimeo.",
    group: "Contenido",
    fields: [...heading(), { key: "url", label: "Enlace del video", kind: "text", max: 300, placeholder: "https://www.youtube.com/watch?v=…" }],
    defaults: { eyebrow: "", title: "Conocé cómo trabajamos", subtitle: "", url: "", bg: "default", space: "normal" },
  },
  logos: {
    label: "Logos",
    description: "Portales, colegios, bancos o marcas con las que trabajás.",
    group: "Confianza",
    fields: [
      ...heading(),
      {
        key: "items",
        label: "Logos",
        kind: "list",
        itemLabel: "Logo",
        max: 16,
        titleKey: "name",
        fields: [
          { key: "image", label: "Imagen", kind: "image" },
          { key: "name", label: "Nombre", kind: "text", max: 60 },
          { key: "link", label: "Enlace", kind: "link" },
        ],
      },
    ],
    defaults: {
      eyebrow: "",
      title: "Publicamos en",
      subtitle: "",
      items: [
        { image: "", name: "Zonaprop", link: "" },
        { image: "", name: "Argenprop", link: "" },
        { image: "", name: "Mercado Libre", link: "" },
        { image: "", name: "Properati", link: "" },
      ],
      bg: "default",
      space: "compact",
    },
  },
  newsletter: {
    label: "Suscripción",
    description: "Para que te dejen su email y reciban novedades.",
    group: "Contacto",
    fields: [...heading(), { key: "submitLabel", label: "Texto del botón", kind: "text", max: 40 }, { key: "success", label: "Mensaje al enviar", kind: "text", max: 200 }],
    defaults: {
      eyebrow: "",
      title: "Recibí las nuevas propiedades antes que nadie",
      subtitle: "Dejanos tu email y te avisamos cuando entre algo para vos.",
      submitLabel: "Suscribirme",
      success: "¡Listo! Te vamos a escribir con novedades.",
      bg: "surface",
      space: "compact",
    },
  },
  staging: {
    label: "Antes y después",
    description: "Comparador de una foto vacía y su ambientación con IA.",
    group: "Contenido",
    fields: [
      ...heading(),
      { key: "before", label: "Foto antes", kind: "image" },
      { key: "after", label: "Foto después", kind: "image" },
      { key: "note", label: "Aclaración", kind: "text", max: 200 },
    ],
    defaults: {
      eyebrow: "Ambientación con IA",
      title: "Mostramos el potencial de cada espacio",
      subtitle: "Deslizá para ver cómo podría verse amueblado.",
      before: "/ejemplos/living-before.webp",
      after: "/ejemplos/living-modern.webp",
      note: "Imagen ilustrativa generada con IA.",
      bg: "default",
      space: "normal",
    },
  },
};

export const SECTION_TYPES = Object.keys(SECTIONS) as SectionType[];
export const SECTION_GROUPS: SectionGroup[] = ["Portada", "Propiedades", "Empresa", "Confianza", "Contacto", "Contenido"];

/* ─────────────────────────── Templates ─────────────────────────── */

export const TEMPLATES = [
  { id: "clasico", label: "Clásico", description: "Serif elegante, verde profundo y tonos cálidos." },
  { id: "moderno", label: "Moderno", description: "Limpio, tipografía geométrica y azul intenso." },
  { id: "premium", label: "Premium", description: "Negro y dorado, para propiedades de alta gama." },
  { id: "barrio", label: "Barrio", description: "Cercano y amigable, bordes redondeados." },
  { id: "minimal", label: "Minimal", description: "Blanco, negro y mucho aire. Las fotos mandan." },
] as const;
export type TemplateId = (typeof TEMPLATES)[number]["id"];
const TEMPLATE_IDS = TEMPLATES.map((t) => t.id) as readonly string[];

export const TEMPLATE_THEMES: Record<TemplateId, { theme: SiteTheme; header: Pick<SiteHeader, "style" | "layout">; footer: Pick<SiteFooter, "style">; hero: Props }> = {
  clasico: {
    theme: {
      primary: "#24382e",
      accent: "#b08d57",
      background: "#fbf8f3",
      surface: "#f1ebe1",
      text: "#22261f",
      headingFont: "playfair",
      bodyFont: "manrope",
      radius: "soft",
      buttons: "solid",
      width: "normal",
      headingCase: "normal",
    },
    header: { style: "transparent", layout: "left" },
    footer: { style: "dark" },
    hero: { variant: "image", height: "l", align: "center", overlay: 45 },
  },
  moderno: {
    theme: {
      primary: "#1d4ed8",
      accent: "#0ea5e9",
      background: "#ffffff",
      surface: "#f3f6fb",
      text: "#0f172a",
      headingFont: "montserrat",
      bodyFont: "inter",
      radius: "soft",
      buttons: "solid",
      width: "wide",
      headingCase: "normal",
    },
    header: { style: "light", layout: "left" },
    footer: { style: "dark" },
    hero: { variant: "split", height: "m", align: "left", overlay: 0 },
  },
  premium: {
    theme: {
      primary: "#111111",
      accent: "#c6a15b",
      background: "#ffffff",
      surface: "#f6f3ee",
      text: "#161616",
      headingFont: "cormorant",
      bodyFont: "dmsans",
      radius: "none",
      buttons: "outline",
      width: "wide",
      headingCase: "upper",
    },
    header: { style: "transparent", layout: "center" },
    footer: { style: "dark" },
    hero: { variant: "image", height: "full", align: "center", overlay: 50 },
  },
  barrio: {
    theme: {
      primary: "#e4572e",
      accent: "#2a9d8f",
      background: "#fffdf8",
      surface: "#fdf0e6",
      text: "#2b2118",
      headingFont: "poppins",
      bodyFont: "poppins",
      radius: "round",
      buttons: "pill",
      width: "normal",
      headingCase: "normal",
    },
    header: { style: "light", layout: "left" },
    footer: { style: "brand" },
    hero: { variant: "image", height: "m", align: "left", overlay: 40 },
  },
  minimal: {
    theme: {
      primary: "#000000",
      accent: "#6b7280",
      background: "#ffffff",
      surface: "#f5f5f4",
      text: "#111111",
      headingFont: "dmsans",
      bodyFont: "dmsans",
      radius: "none",
      buttons: "solid",
      width: "wide",
      headingCase: "normal",
    },
    header: { style: "light", layout: "left" },
    footer: { style: "light" },
    hero: { variant: "minimal", height: "s", align: "left", overlay: 0 },
  },
};

/** What the agency already told habita: used to prefill a new site. */
export type SiteSeed = {
  name: string;
  primary?: string | null;
  whatsapp?: string | null;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
};

export const uid = () => {
  try {
    return crypto.randomUUID().slice(0, 12);
  } catch {
    return Math.random().toString(36).slice(2, 14);
  }
};

export function newSection(type: SectionType, overrides: Props = {}): Section {
  return { id: uid(), type, props: cleanProps(type, { ...structuredClone(SECTIONS[type].defaults), ...overrides }) };
}

const page = (title: string, slug: string, sections: Section[], nav = true): SitePage => ({ id: uid(), title, slug, nav, seoTitle: "", seoDescription: "", sections });

const pageHero = (title: string, subtitle: string, image: string): Section =>
  newSection("hero", { variant: "image", title, subtitle, image, height: "s", search: false, overlay: 55, align: "center" });

/** A complete site to start from: the template's look and its pages, with the agency's data. */
export function templateSite(template: TemplateId, seed: SiteSeed): SiteDoc {
  const t = TEMPLATE_THEMES[template];
  const theme: SiteTheme = { ...t.theme };
  // The agency's color wins over the template's, except in the black-and-white ones.
  if (seed.primary && /^#[0-9a-f]{6}$/i.test(seed.primary) && template !== "minimal" && template !== "premium") theme.primary = seed.primary.toLowerCase();
  const premium = template === "premium";
  const home: Section[] = [
    newSection("hero", {
      ...t.hero,
      eyebrow: premium ? seed.name : "",
      title: premium ? "Propiedades únicas" : "Encontrá tu próximo hogar",
      image: premium ? "/ejemplos/living-luxury.webp" : template === "barrio" ? "/ejemplos/living-farmhouse.webp" : "/ejemplos/living-modern.webp",
      search: template !== "minimal",
      ...(template === "minimal" ? { buttonLabel: "Ver propiedades", buttonLink: "/propiedades" } : {}),
    }),
    newSection("featured", template === "minimal" ? { eyebrow: "", title: "Últimas propiedades", count: 9 } : premium ? { layout: "carousel" } : {}),
    newSection("services", premium ? { bg: "surface" } : {}),
    newSection("about", { title: `Somos ${seed.name}` }),
    newSection("stats", premium ? { bg: "dark" } : {}),
    ...(template === "barrio" ? [newSection("zones")] : []),
    ...(template === "moderno" || template === "clasico" ? [newSection("staging")] : []),
    newSection("testimonials"),
    newSection("cta"),
    newSection("contact"),
  ];
  const doc: SiteDoc = {
    version: SITE_VERSION,
    template,
    theme,
    header: { ...t.header, sticky: true, ctaLabel: "Tasá tu propiedad", ctaLink: "/tasaciones", showPhone: false },
    footer: {
      ...t.footer,
      about: `${seed.name}: propiedades en venta y alquiler, tasaciones y administración.`,
      showPages: true,
      showContact: true,
      showSocial: true,
      legal: "",
    },
    settings: {
      ...EMPTY_SETTINGS,
      tagline: "Propiedades en venta y alquiler",
      whatsapp: seed.whatsapp ?? "",
      phone: seed.phone ?? "",
      email: seed.email ?? "",
      seoTitle: `${seed.name} · Propiedades en venta y alquiler`,
      seoDescription: `Propiedades en venta y alquiler de ${seed.name}. Tasaciones, administración y asesoramiento.`,
      whatsappButton: Boolean(seed.whatsapp),
    },
    pages: [
      page("Inicio", "", home),
      page("Propiedades", "propiedades", [newSection("listings")]),
      page("Nosotros", "nosotros", [
        pageHero("Nosotros", "Conocé quiénes somos y cómo trabajamos.", "/ejemplos/office-classic.webp"),
        newSection("about", { title: `Somos ${seed.name}`, buttonLabel: "", buttonLink: "", bg: "default" }),
        newSection("stats"),
        newSection("steps", { title: "Cómo trabajamos" }),
        newSection("team"),
        newSection("testimonials"),
      ]),
      page("Tasaciones", "tasaciones", [
        pageHero("Tasá tu propiedad", "Sin costo y con datos reales del mercado.", "/ejemplos/dining-classic.webp"),
        newSection("valuation"),
        newSection("steps"),
        newSection("faq"),
      ]),
      page("Contacto", "contacto", [newSection("contact", { map: true, space: "roomy" })]),
    ],
  };
  return doc;
}

export const EMPTY_SETTINGS: SiteSettings = {
  tagline: "",
  phone: "",
  whatsapp: "",
  email: "",
  address: "",
  hours: "",
  license: "",
  instagram: "",
  facebook: "",
  linkedin: "",
  youtube: "",
  tiktok: "",
  seoTitle: "",
  seoDescription: "",
  shareImage: "",
  indexable: true,
  ga4: "",
  metaPixel: "",
  whatsappButton: true,
  whatsappMessage: "",
  announcement: "",
  announcementLink: "",
};

/** Ready-made pages to add with one click. */
export const PAGE_PRESETS: { id: string; title: string; slug: string; build: () => Section[] }[] = [
  { id: "blank", title: "Página en blanco", slug: "pagina", build: () => [newSection("text")] },
  { id: "propiedades", title: "Propiedades", slug: "propiedades", build: () => [newSection("listings")] },
  { id: "venta", title: "Venta", slug: "venta", build: () => [newSection("listings", { title: "Propiedades en venta", operation: "venta" })] },
  { id: "alquiler", title: "Alquiler", slug: "alquiler", build: () => [newSection("listings", { title: "Propiedades en alquiler", operation: "alquiler" })] },
  { id: "nosotros", title: "Nosotros", slug: "nosotros", build: () => [newSection("about", { buttonLabel: "", buttonLink: "" }), newSection("team"), newSection("testimonials")] },
  { id: "tasaciones", title: "Tasaciones", slug: "tasaciones", build: () => [newSection("valuation"), newSection("steps"), newSection("faq")] },
  { id: "servicios", title: "Servicios", slug: "servicios", build: () => [newSection("services"), newSection("steps"), newSection("cta")] },
  { id: "contacto", title: "Contacto", slug: "contacto", build: () => [newSection("contact", { map: true })] },
  { id: "faq", title: "Preguntas frecuentes", slug: "preguntas", build: () => [newSection("faq")] },
];

/* ─────────────────────────── Validation ─────────────────────────── */

const HEX = /^#[0-9a-f]{6}$/i;
export const PAGE_SLUG = /^[a-z0-9](?:[a-z0-9-]{0,17}[a-z0-9])$/;
const str = (v: unknown, max: number, fallback = "") => (typeof v === "string" ? v.replaceAll("\u0000", "").trim().slice(0, max) : fallback);
const oneOf = <T extends string>(v: unknown, options: readonly T[], fallback: T): T => (typeof v === "string" && (options as readonly string[]).includes(v) ? (v as T) : fallback);
const bool = (v: unknown, fallback: boolean) => (typeof v === "boolean" ? v : fallback);
const color = (v: unknown, fallback: string) => (typeof v === "string" && HEX.test(v) ? v.toLowerCase() : fallback);

/** A safe link: a page of the site (/…), an anchor (#…), web, email, phone or WhatsApp (wa:). */
export function cleanLink(v: unknown): string {
  const s = str(v, 500);
  if (!s) return "";
  if (/^\/(?!\/)[^\s]*$/.test(s) || /^#[\w-]{1,40}$/.test(s) || /^wa:[\d+]*$/.test(s)) return s;
  if (/^(mailto|tel):[^\s<>"]+$/i.test(s)) return s;
  if (/^https?:\/\/[^\s<>"]+$/i.test(s)) return s;
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)+(\/[^\s<>"]*)?$/i.test(s)) return `https://${s}`;
  return "";
}
/** An image: one of habita's examples, an upload to the site's bucket, or any https image. */
export function cleanImage(v: unknown): string {
  const s = str(v, 600);
  if (!s) return "";
  if (/^\/(?!\/)[^\s"'<>]+$/.test(s)) return s;
  if (/^https:\/\/[^\s<>"']+$/i.test(s)) return s;
  return "";
}

function cleanField(f: Field, v: unknown, fallback: unknown): unknown {
  switch (f.kind) {
    case "text":
    case "textarea":
      return typeof v === "string" ? str(v, f.max ?? 300) : typeof fallback === "string" ? fallback : "";
    case "link":
      return v === undefined ? (fallback ?? "") : cleanLink(v);
    case "image":
      return v === undefined ? (fallback ?? "") : cleanImage(v);
    case "color":
      return color(v, typeof fallback === "string" ? fallback : "#000000");
    case "select":
      return oneOf(v, f.options.map((o) => o[0]), (typeof fallback === "string" ? fallback : f.options[0]![0]) as string);
    case "icon":
      return oneOf(v, ICONS.map((o) => o[0]), (typeof fallback === "string" ? fallback : "home") as IconId);
    case "toggle":
      return bool(v, typeof fallback === "boolean" ? fallback : false);
    case "number": {
      const n = typeof v === "number" && Number.isFinite(v) ? v : typeof fallback === "number" ? fallback : f.min;
      return Math.min(f.max, Math.max(f.min, Math.round(n)));
    }
    case "list": {
      const items = Array.isArray(v) ? v : Array.isArray(fallback) ? fallback : [];
      return items
        .filter((i): i is Props => Boolean(i) && typeof i === "object")
        .slice(0, f.max)
        .map((i) => {
          const out: Props = {};
          for (const sub of f.fields) out[sub.key] = cleanField(sub, i[sub.key], undefined);
          return out;
        });
    }
  }
}

export function cleanProps(type: SectionType, props: unknown): Props {
  const p = props && typeof props === "object" ? (props as Props) : {};
  const def = SECTIONS[type];
  const out: Props = {};
  for (const f of [...def.fields, ...COMMON_FIELDS]) out[f.key] = cleanField(f, p[f.key], def.defaults[f.key]);
  out.anchor = String(out.anchor ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 30);
  return out;
}

const cleanId = (v: unknown) => (typeof v === "string" && /^[\w-]{4,40}$/.test(v) ? v : uid());

/**
 * Whatever comes in (the editor, an old version, a hand-made request), a
 * complete and safe site: known sections only, every field within its
 * limits, unique page addresses and a home page.
 */
export function normalizeSite(input: unknown, seed: SiteSeed = { name: "Mi inmobiliaria" }): SiteDoc {
  const raw = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const template = oneOf(raw.template, TEMPLATE_IDS, "clasico") as TemplateId;
  const base = templateSite(template, seed);
  const t = (raw.theme ?? {}) as Record<string, unknown>;
  const fontIds = FONTS.map((f) => f[0]);
  const theme: SiteTheme = {
    primary: color(t.primary, base.theme.primary),
    accent: color(t.accent, base.theme.accent),
    background: color(t.background, base.theme.background),
    surface: color(t.surface, base.theme.surface),
    text: color(t.text, base.theme.text),
    headingFont: oneOf(t.headingFont, fontIds, base.theme.headingFont),
    bodyFont: oneOf(t.bodyFont, fontIds, base.theme.bodyFont),
    radius: oneOf(t.radius, ["none", "soft", "round"], base.theme.radius),
    buttons: oneOf(t.buttons, ["solid", "outline", "pill"], base.theme.buttons),
    width: oneOf(t.width, ["normal", "wide"], base.theme.width),
    headingCase: oneOf(t.headingCase, ["normal", "upper"], base.theme.headingCase),
  };
  const h = (raw.header ?? {}) as Record<string, unknown>;
  const header: SiteHeader = {
    style: oneOf(h.style, ["light", "dark", "brand", "transparent"], base.header.style),
    layout: oneOf(h.layout, ["left", "center"], base.header.layout),
    sticky: bool(h.sticky, base.header.sticky),
    ctaLabel: "ctaLabel" in h ? str(h.ctaLabel, 40) : base.header.ctaLabel,
    ctaLink: "ctaLink" in h ? cleanLink(h.ctaLink) : base.header.ctaLink,
    showPhone: bool(h.showPhone, base.header.showPhone),
  };
  const f = (raw.footer ?? {}) as Record<string, unknown>;
  const footer: SiteFooter = {
    style: oneOf(f.style, ["dark", "light", "brand"], base.footer.style),
    about: "about" in f ? str(f.about, 400) : base.footer.about,
    showPages: bool(f.showPages, true),
    showContact: bool(f.showContact, true),
    showSocial: bool(f.showSocial, true),
    legal: str(f.legal, 400),
  };
  const s = (raw.settings ?? {}) as Record<string, unknown>;
  const text = (k: keyof SiteSettings, max: number) => (k in s ? str(s[k], max) : (base.settings[k] as string));
  const settings: SiteSettings = {
    tagline: text("tagline", 120),
    phone: text("phone", 40),
    whatsapp: text("whatsapp", 40),
    email: text("email", 120),
    address: text("address", 200),
    hours: text("hours", 120),
    license: text("license", 120),
    instagram: cleanLink(s.instagram),
    facebook: cleanLink(s.facebook),
    linkedin: cleanLink(s.linkedin),
    youtube: cleanLink(s.youtube),
    tiktok: cleanLink(s.tiktok),
    seoTitle: text("seoTitle", 70),
    seoDescription: text("seoDescription", 170),
    shareImage: cleanImage(s.shareImage),
    indexable: bool(s.indexable, true),
    ga4: /^G-[A-Z0-9]{4,14}$/.test(str(s.ga4, 20)) ? str(s.ga4, 20) : "",
    metaPixel: /^\d{6,20}$/.test(str(s.metaPixel, 20)) ? str(s.metaPixel, 20) : "",
    whatsappButton: bool(s.whatsappButton, base.settings.whatsappButton),
    whatsappMessage: text("whatsappMessage", 300),
    announcement: text("announcement", 160),
    announcementLink: cleanLink(s.announcementLink),
  };
  const rawPages = Array.isArray(raw.pages) ? raw.pages : null;
  const used = new Set<string>();
  const pages: SitePage[] = [];
  for (const rp of rawPages ?? base.pages) {
    if (!rp || typeof rp !== "object" || pages.length >= 20) continue;
    const p = rp as Record<string, unknown>;
    let slug = str(p.slug, 19).toLowerCase();
    if (slug && !PAGE_SLUG.test(slug)) slug = slug.replace(/[^a-z0-9-]/g, "-").replace(/^-+|-+$/g, "").slice(0, 19);
    if (slug && !PAGE_SLUG.test(slug)) slug = "pagina";
    // The first page without an address is the home; the rest get one.
    if (!slug && used.has("")) slug = "pagina";
    let unique = slug;
    for (let i = 2; used.has(unique); i++) unique = `${slug.slice(0, 16)}-${i}`;
    used.add(unique);
    const sections = (Array.isArray(p.sections) ? p.sections : [])
      .filter((x): x is Record<string, unknown> => Boolean(x) && typeof x === "object" && SECTION_TYPES.includes((x as Section).type))
      .slice(0, 40)
      .map((x) => ({
        id: cleanId(x.id),
        type: x.type as SectionType,
        ...(x.hidden === true ? { hidden: true } : {}),
        props: cleanProps(x.type as SectionType, x.props),
      }));
    pages.push({
      id: cleanId(p.id),
      title: str(p.title, 40) || "Página",
      slug: unique,
      nav: bool(p.nav, true),
      seoTitle: str(p.seoTitle, 70),
      seoDescription: str(p.seoDescription, 170),
      sections,
    });
  }
  if (!pages.some((p) => p.slug === "")) pages.unshift({ ...base.pages[0]! });
  // The home always goes first.
  pages.sort((a, b) => (a.slug === "" ? -1 : b.slug === "" ? 1 : 0));
  return { version: SITE_VERSION, template, theme, header, footer, settings, pages };
}

/* ─────────────────────────── Helpers ─────────────────────────── */

/** The site's address on habita, and a page's within it. */
export const siteBase = (slug: string) => `/inmobiliaria/${slug}`;
export const pagePath = (slug: string, page: string) => (page ? `${siteBase(slug)}/${page}` : siteBase(slug));

/** Digits only, Argentine mobile numbers completed for wa.me. */
export function waNumber(v: string): string | null {
  let d = v.replace(/\D/g, "");
  if (!d) return null;
  if (d.startsWith("00")) d = d.slice(2);
  if (d.startsWith("0")) d = d.slice(1);
  if (!d.startsWith("54")) d = `54${d}`;
  // 54 + 9 + area + number for mobiles; leave it if already there.
  if (/^54(?!9)\d{10}$/.test(d)) d = `549${d.slice(2)}`;
  return d.length >= 10 && d.length <= 15 ? d : null;
}

/** Readable text color (dark or white) over a background. */
export function inkOn(hex: string): string {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return "#ffffff";
  const [r, g, b] = [m[1], m[2], m[3]].map((x) => {
    const c = parseInt(x!, 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  const l = 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
  return l > 0.36 ? "#141414" : "#ffffff";
}

/** A YouTube or Vimeo link as its embed address, or null. */
export function videoEmbed(url: string): string | null {
  const yt = /(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{6,20})/.exec(url);
  if (yt) return `https://www.youtube-nocookie.com/embed/${yt[1]}`;
  const vimeo = /vimeo\.com\/(?:video\/)?(\d{5,12})/.exec(url);
  if (vimeo) return `https://player.vimeo.com/video/${vimeo[1]}`;
  return null;
}

/** Stored in agencies.site. */
export type StoredSite = { draft?: unknown; published?: unknown; publishedAt?: string | null; updatedAt?: string | null };
