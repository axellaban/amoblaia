// The agency's panel seen as a guest (docs/ACCESO_PANEL.md): what the
// exploration funnel records. Pure and client-safe.

/** Browser key: this browser already chose how to enter this agency's panel (the welcome is not shown again). */
export const entryChoiceKey = (agencyId: string, signedIn = false) => `habita_panel_entrada:${agencyId}${signedIn ? ":sesion" : ""}`;

/** The panel's sections by their first path segment; the home is "inicio". */
const SECTIONS = new Set(["inicio", "propiedades", "imagenes", "video", "usuarios", "sitio", "tour-360", "planos", "redes", "api", "creditos", "cuenta"]);

const sectionOf = (pathname: string) => {
  const first = pathname.replace(/^\/panel\/?/, "").split("/")[0];
  return first === "" ? "inicio" : first;
};

export type ExplorationClick = {
  event: "panel_exploration_section_clicked" | "panel_exploration_property_opened";
  properties: Record<string, string>;
};

/**
 * What a click on a link inside the panel means for the funnel: a property
 * (or demo) opened, another section opened, or nothing (same section, sign-up
 * pages, other sites). `origen` is where the link was: sidebar, barra, contenido.
 */
export function explorationClick(href: string, currentPath: string, origen: string): ExplorationClick | null {
  let url: URL;
  try {
    url = new URL(href, "https://panel.invalid");
  } catch {
    return null;
  }
  if (url.origin !== "https://panel.invalid" || !/^\/panel(\/|$)/.test(url.pathname)) return null;
  const property = /^\/panel\/propiedades\/([^/]+)/.exec(url.pathname);
  if (property && property[1] !== "nueva")
    return { event: "panel_exploration_property_opened", properties: { origen, vista: url.pathname.endsWith("/vista-previa") ? "vista_previa" : "editor" } };
  const section = sectionOf(url.pathname);
  if (!SECTIONS.has(section) || section === sectionOf(currentPath)) return null;
  return { event: "panel_exploration_section_clicked", properties: { section, origen } };
}
