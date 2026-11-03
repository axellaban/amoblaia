/**
 * The PostHog dashboards, funnels and actions of habita, as data. The script
 * `scripts/posthog-setup.ts` creates them in the project (or updates them, by
 * name), so the dashboards always match the events the code sends. Every
 * event named here is checked against the source by tests/analytics-setup.test.ts.
 * Documented in docs/ANALITICA_DEMOS.md.
 */

export type Filter =
  | { type: "event"; key: string; value: (string | number | boolean)[]; operator?: "exact" | "is_not" }
  | { type: "hogql"; key: string };

export type Step = { event: string; name?: string; filters?: Filter[] } | { action: string; name?: string; filters?: Filter[] };

export type InsightDef =
  | { kind: "funnel"; name: string; description: string; steps: Step[]; windowDays?: number; breakdown?: string; layout?: "vertical" | "horizontal" }
  | { kind: "trend"; name: string; description: string; series: Step[]; breakdown?: string; display?: "ActionsTable" | "ActionsLineGraph" | "ActionsBarValue"; interval?: "day" | "week"; math?: "total" | "dau" }
  | { kind: "hogql"; name: string; description: string; sql: string };

export type DashboardDef = { name: string; description: string; insights: InsightDef[] };

/** An action groups several events into one funnel step ("agency created OR claimed"). */
export type ActionDef = { name: string; description: string; steps: { event: string; filters?: Filter[] }[] };

/** The tag on everything the script creates: how it finds them again. */
export const SETUP_TAG = "habita-setup";

/** Production, outside traffic only: the team's devices carry is_internal (see interaction-tracking.ts). */
export const GLOBAL_FILTERS: Filter[] = [
  { type: "event", key: "app_env", value: ["production"] },
  { type: "hogql", key: "coalesce(toString(properties.is_internal), '') != 'true'" },
];

const is = (key: string, ...value: (string | number | boolean)[]): Filter => ({ type: "event", key, value });

/** The links the team sends to agencies (not buyers): the start of every commercial funnel. */
const PRESENTATION = is("demo_link_type", "owner_invitation", "presentation_invitation", "presentation");
const B2B_SIGNUP_CTA = [is("cta_kind", "habita_b2b"), is("cta_destination", "signup_invitation", "agency_signup")];

export const ACTIONS: ActionDef[] = [
  {
    name: "habita · Inmobiliaria creada o reclamada",
    description: "La cuenta B2B existe: alta nueva (agency_created) o demos pasadas a su cuenta (agency_claimed).",
    steps: [{ event: "agency_created" }, { event: "agency_claimed" }],
  },
  {
    name: "habita · Clic en cualquier elemento",
    description: "Todos los clics medidos: CTAs con id (cta_clicked) y el resto (ui_clicked).",
    steps: [{ event: "cta_clicked" }, { event: "ui_clicked" }],
  },
  {
    name: "habita · Propiedad compartida",
    description: "La inmobiliaria compartió una ficha: nativo, copiar, WhatsApp o copia manual.",
    steps: [{ event: "property_shared" }, { event: "property_share_opened" }],
  },
  {
    name: "habita · Generación con IA completada",
    description: "Una versión con IA terminó, en el panel o desde la demo.",
    steps: [{ event: "property_ai_generation_completed" }, { event: "demo_generation_completed" }],
  },
  {
    name: "habita · Quiso comprar créditos",
    description: "Clic hacia precios o el checkout desde el panel o la demo.",
    steps: [
      { event: "cta_clicked", filters: [is("cta_destination", "panel_credits", "pricing", "pricing_section", "checkout")] },
      { event: "plan_click" },
    ],
  },
];

const AGENCY_READY: Step = { action: "habita · Inmobiliaria creada o reclamada", name: "Inmobiliaria creada o reclamada" };

export const DASHBOARDS: DashboardDef[] = [
  {
    name: "habita · Embudo comercial",
    description: "Desde la demo que el equipo manda a una inmobiliaria hasta que paga. Solo producción, sin tráfico interno.",
    insights: [
      {
        kind: "funnel",
        name: "Demo → cliente (30 días)",
        description: "El recorrido completo de una inmobiliaria: ve su demo, pide su panel, crea la cuenta, importa, genera y compra.",
        windowDays: 30,
        steps: [
          { event: "demo_vista", name: "Vio su demo", filters: [PRESENTATION] },
          { event: "cta_clicked", name: "Clic para crear su panel", filters: B2B_SIGNUP_CTA },
          { event: "signup_form_viewed", name: "Vio el registro" },
          { event: "signup_form_started", name: "Empezó a completar" },
          { event: "account_created", name: "Cuenta creada" },
          AGENCY_READY,
          { event: "first_import_completed", name: "Primera importación" },
          { event: "first_generation_completed", name: "Primera generación con IA" },
          { event: "checkout_creado", name: "Fue al checkout" },
          { event: "compra_confirmada", name: "Compró" },
        ],
      },
      {
        kind: "funnel",
        name: "Demo → registro, por CTA",
        description: "Qué botón de la demo lleva más inmobiliarias a registrarse (desglose por cta_id del paso 2).",
        windowDays: 14,
        breakdown: "cta_id",
        steps: [
          { event: "demo_vista", name: "Vio su demo", filters: [PRESENTATION] },
          { event: "cta_clicked", name: "Clic para crear su panel", filters: B2B_SIGNUP_CTA },
          { event: "account_created", name: "Cuenta creada" },
        ],
      },
      {
        kind: "funnel",
        name: "Demo → registro, por dispositivo",
        description: "Conversión de la demo al registro en teléfono y computadora.",
        windowDays: 14,
        breakdown: "$device_type",
        steps: [
          { event: "demo_vista", name: "Vio su demo", filters: [PRESENTATION] },
          { event: "comparison_slider_used", name: "Usó el comparador" },
          { event: "cta_clicked", name: "Clic para crear su panel", filters: B2B_SIGNUP_CTA },
          { event: "signup_form_viewed", name: "Vio el registro" },
          { event: "account_created", name: "Cuenta creada" },
        ],
      },
      {
        kind: "funnel",
        name: "Registro: dónde abandonan",
        description: "Del formulario visto a la inmobiliaria lista, desglosado por formulario (flow).",
        windowDays: 7,
        breakdown: "flow",
        steps: [
          { event: "signup_form_viewed", name: "Vio el formulario" },
          { event: "signup_form_started", name: "Empezó a completar" },
          { event: "signup_form_submitted", name: "Envió" },
          { event: "account_created", name: "Cuenta creada" },
          AGENCY_READY,
        ],
      },
      {
        kind: "trend",
        name: "Errores del registro",
        description: "signup_form_error por tipo de error (nunca el mensaje ni lo escrito).",
        series: [{ event: "signup_form_error" }],
        breakdown: "error_kind",
        display: "ActionsTable",
      },
      {
        kind: "trend",
        name: "Inmobiliarias nuevas por semana",
        description: "Altas y reclamos de inmobiliarias.",
        series: [AGENCY_READY],
        interval: "week",
        display: "ActionsBarValue",
      },
    ],
  },
  {
    name: "habita · Demos: qué hacen las inmobiliarias",
    description: "Cómo interactúan con la demo que les mandamos: dónde cliquean, cuánto miran, hasta dónde llegan.",
    insights: [
      {
        kind: "funnel",
        name: "Profundidad de la demo",
        description: "Qué parte de quienes abren la demo prueba el comparador, cambia estilo, recorre fotos y llega al cierre.",
        windowDays: 1,
        layout: "horizontal",
        steps: [
          { event: "demo_vista", name: "Abrió la demo", filters: [PRESENTATION] },
          { event: "comparison_slider_used", name: "Movió el comparador" },
          { event: "demo_estilo", name: "Cambió de estilo" },
          { event: "demo_photo_changed", name: "Pasó de foto" },
          { event: "cta_clicked", name: "Clic en un CTA de habita", filters: [is("cta_kind", "habita_b2b")] },
        ],
      },
      {
        kind: "trend",
        name: "CTAs más cliqueados en la demo",
        description: "cta_clicked en demos, por cta_id: separa habita_b2b (comercial) de buyer_contact (compradores).",
        series: [{ event: "cta_clicked", filters: [is("surface", "demo", "agency_site_property")] }],
        breakdown: "cta_id",
        display: "ActionsTable",
      },
      {
        kind: "trend",
        name: "Otros clics en la demo",
        description: "ui_clicked en demos por etiqueta visible: botones y enlaces sin id propio.",
        series: [{ event: "ui_clicked", filters: [is("surface", "demo", "agency_site_property")] }],
        breakdown: "ui_label",
        display: "ActionsTable",
      },
      {
        kind: "trend",
        name: "Hasta dónde llegan (secciones vistas)",
        description: "section_viewed por sección, visitantes únicos: cuántos llegan a la galería, al contacto, al cierre.",
        series: [{ event: "section_viewed", filters: [is("surface", "demo", "agency_site_property")] }],
        breakdown: "section",
        display: "ActionsTable",
        math: "dau",
      },
      {
        kind: "trend",
        name: "Estilos elegidos",
        description: "demo_estilo por estilo.",
        series: [{ event: "demo_estilo" }],
        breakdown: "style_id",
        display: "ActionsTable",
      },
      {
        kind: "trend",
        name: "Demos vistas por inmobiliaria",
        description: "Visitantes únicos de demo_vista (enlaces de presentación) por inmobiliaria.",
        series: [{ event: "demo_vista", filters: [PRESENTATION] }],
        breakdown: "demo_inmobiliaria",
        display: "ActionsTable",
        math: "dau",
      },
      {
        kind: "hogql",
        name: "Tiempo activo por demo",
        description: "Suma de demo_active_time por visita (sesión), mediana y total por demo, últimos 30 días.",
        sql: `SELECT demo, any(titulo) AS titulo, any(inmobiliaria) AS inmobiliaria, count() AS visitas,
       round(median(s) / 1000) AS mediana_seg, round(sum(s) / 60000) AS total_min
FROM (
  SELECT properties.demo_id AS demo, any(properties.demo_titulo) AS titulo, any(properties.demo_inmobiliaria) AS inmobiliaria,
         \`$session_id\` AS session, sum(toFloat(properties.active_ms)) AS s
  FROM events
  WHERE event = 'demo_active_time' AND timestamp > now() - INTERVAL 30 DAY
    AND properties.app_env = 'production' AND coalesce(toString(properties.is_internal), '') != 'true'
  GROUP BY demo, session
)
GROUP BY demo ORDER BY total_min DESC LIMIT 100`,
      },
    ],
  },
  {
    name: "habita · Panel: activación y uso",
    description: "Qué hace la inmobiliaria dentro de su panel: importar, ambientar, publicar, compartir, comprar.",
    insights: [
      {
        kind: "funnel",
        name: "Activación del panel (14 días)",
        description: "De la cuenta lista a la primera ficha compartida.",
        windowDays: 14,
        steps: [
          AGENCY_READY,
          { event: "property_import_started", name: "Empezó una importación" },
          { event: "property_import_completed", name: "Importó una propiedad" },
          { event: "property_ai_generation_started", name: "Pidió una generación" },
          { action: "habita · Generación con IA completada", name: "Generación lista" },
          { event: "property_published", name: "Publicó la ficha" },
          { action: "habita · Propiedad compartida", name: "Compartió la ficha" },
        ],
      },
      {
        kind: "funnel",
        name: "Créditos: del límite a la compra",
        description: "La pared de créditos del panel, el clic a comprar, el checkout y el pago.",
        windowDays: 7,
        steps: [
          { event: "credits_limit_viewed", name: "Se quedó sin créditos" },
          { action: "habita · Quiso comprar créditos", name: "Clic para comprar" },
          { event: "checkout_creado", name: "Checkout creado" },
          { event: "compra_confirmada", name: "Pago confirmado" },
        ],
      },
      {
        kind: "funnel",
        name: "Importación: lectura → propiedad",
        description: "Leer la publicación, confirmar y terminar, por portal de origen.",
        windowDays: 1,
        breakdown: "source",
        steps: [
          { event: "listing_import_preview_started", name: "Pegó un enlace" },
          { event: "listing_import_preview_completed", name: "Se leyó" },
          { event: "listing_import_confirmed", name: "Confirmó" },
          { event: "property_import_completed", name: "Propiedad creada" },
        ],
      },
      {
        kind: "trend",
        name: "CTAs más cliqueados en el panel",
        description: "cta_clicked en el panel por cta_id.",
        series: [{ event: "cta_clicked", filters: [is("surface", "panel")] }],
        breakdown: "cta_id",
        display: "ActionsTable",
      },
      {
        kind: "trend",
        name: "Clics por pantalla del panel",
        description: "Todos los clics del panel (cta_clicked + ui_clicked) por pantalla (route).",
        series: [{ action: "habita · Clic en cualquier elemento", filters: [is("surface", "panel")] }],
        breakdown: "route",
        display: "ActionsTable",
      },
      {
        kind: "trend",
        name: "Otros clics en el panel",
        description: "ui_clicked en el panel por etiqueta: lo que tocan además de los CTAs.",
        series: [{ event: "ui_clicked", filters: [is("surface", "panel")] }],
        breakdown: "ui_label",
        display: "ActionsTable",
      },
      {
        kind: "trend",
        name: "Pantallas del panel más vistas",
        description: "$pageview del panel por pantalla, usuarios únicos.",
        series: [{ event: "$pageview", filters: [is("surface", "panel")] }],
        breakdown: "route",
        display: "ActionsTable",
        math: "dau",
      },
      {
        kind: "trend",
        name: "Formularios enviados",
        description: "form_submitted por formulario (nunca su contenido).",
        series: [{ event: "form_submitted" }],
        breakdown: "form_id",
        display: "ActionsTable",
      },
      {
        kind: "trend",
        name: "Frustración: clics sin respuesta y clics repetidos",
        description: "$dead_click y $rageclick por pantalla: botones que no responden o confunden.",
        series: [{ event: "$dead_click" }, { event: "$rageclick" }],
        breakdown: "route",
        display: "ActionsTable",
      },
    ],
  },
];

/** Every event the dashboards and actions read. */
export function eventsUsed(): string[] {
  const out = new Set<string>();
  for (const a of ACTIONS) for (const s of a.steps) out.add(s.event);
  for (const d of DASHBOARDS)
    for (const i of d.insights) {
      const steps = i.kind === "funnel" ? i.steps : i.kind === "trend" ? i.series : [];
      for (const s of steps) if ("event" in s) out.add(s.event);
    }
  return [...out].sort();
}

/** The PostHog property filter of one definition. */
function filterOf(f: Filter) {
  return f.type === "hogql" ? { type: "hogql", key: f.key } : { type: "event", key: f.key, value: f.value, operator: f.operator ?? "exact" };
}

/** A funnel step or trend series as a PostHog query node. `actionIds` maps action names to their ids. */
function nodeOf(step: Step, actionIds: Map<string, number>, math?: string) {
  const extra = math && math !== "total" ? { math } : {};
  if ("action" in step) {
    const id = actionIds.get(step.action);
    if (id === undefined) throw new Error(`Acción sin crear: ${step.action}`);
    return {
      kind: "ActionsNode",
      id,
      name: step.action,
      ...(step.name ? { custom_name: step.name } : {}),
      ...(step.filters?.length ? { properties: step.filters.map(filterOf) } : {}),
      ...extra,
    };
  }
  return {
    kind: "EventsNode",
    event: step.event,
    name: step.event,
    ...(step.name ? { custom_name: step.name } : {}),
    ...(step.filters?.length ? { properties: step.filters.map(filterOf) } : {}),
    ...extra,
  };
}

/** The `query` of one insight, as the PostHog API takes it. */
export function queryOf(def: InsightDef, actionIds: Map<string, number>) {
  if (def.kind === "hogql") return { kind: "DataTableNode", source: { kind: "HogQLQuery", query: def.sql } };
  const common = {
    dateRange: { date_from: "-30d" },
    filterTestAccounts: true,
    properties: { type: "AND", values: [{ type: "AND", values: GLOBAL_FILTERS.map(filterOf) }] },
    ...(def.breakdown ? { breakdownFilter: { breakdown: def.breakdown, breakdown_type: "event" } } : {}),
  };
  if (def.kind === "funnel")
    return {
      kind: "InsightVizNode",
      source: {
        kind: "FunnelsQuery",
        series: def.steps.map((s) => nodeOf(s, actionIds)),
        funnelsFilter: { funnelWindowInterval: def.windowDays ?? 14, funnelWindowIntervalUnit: "day", funnelOrderType: "ordered", layout: def.layout ?? "vertical" },
        ...common,
      },
    };
  return {
    kind: "InsightVizNode",
    source: {
      kind: "TrendsQuery",
      series: def.series.map((s) => nodeOf(s, actionIds, def.math)),
      interval: def.interval ?? "day",
      trendsFilter: { display: def.display ?? "ActionsLineGraph" },
      ...common,
    },
  };
}

/** An action as the PostHog API takes it. */
export function actionBody(a: ActionDef) {
  return {
    name: a.name,
    description: a.description,
    tags: [SETUP_TAG],
    steps: a.steps.map((s) => ({ event: s.event, ...(s.filters?.length ? { properties: s.filters.map(filterOf) } : {}) })),
  };
}
