// Creates (or updates, by name) the PostHog actions, dashboards and insights
// of habita defined in src/lib/analytics-setup.ts. Dry-run by default: it
// prints what it would send. Idempotent: running it again updates the same
// objects (found by name and the habita-setup tag) instead of duplicating them.
//
//   node --experimental-strip-types scripts/posthog-setup.ts                  # dry-run
//   node --experimental-strip-types scripts/posthog-setup.ts --apply          # crea / actualiza
//   node --experimental-strip-types scripts/posthog-setup.ts --apply --rename-project="habita"
//
// --rename-project renames the PostHog project (it used to be «amoblaia»).
// Needs POSTHOG_PROJECT_ID and POSTHOG_PERSONAL_API_KEY (scopes: action:write,
// dashboard:write, insight:write and, to rename, project:write); POSTHOG_HOST
// defaults to https://us.posthog.com. Never prints the key.
import { ACTIONS, DASHBOARDS, SETUP_TAG, actionBody, queryOf } from "../src/lib/analytics-setup.ts";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const rename = args.find((a) => a.startsWith("--rename-project="))?.slice("--rename-project=".length);
const host = (process.env.POSTHOG_HOST || "https://us.posthog.com").replace(/\/$/, "");

type Named = { id: number; name: string | null; tags?: string[]; deleted?: boolean };

function env(k: string) {
  const v = process.env[k];
  if (!v) throw new Error(`Falta ${k}`);
  return v;
}

async function ph<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`${host}/api/projects/${env("POSTHOG_PROJECT_ID")}${path}`, {
    method: init.method ?? "GET",
    headers: { Authorization: `Bearer ${env("POSTHOG_PERSONAL_API_KEY")}`, "Content-Type": "application/json" },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  if (!res.ok) throw new Error(`${init.method ?? "GET"} ${path}: ${res.status} ${(await res.text()).slice(0, 400)}`);
  return (await res.json()) as T;
}

/** Every page of a list endpoint. */
async function all<T extends Named>(path: string): Promise<T[]> {
  const out: T[] = [];
  let next: string | null = `${path}${path.includes("?") ? "&" : "?"}limit=200`;
  while (next) {
    const page: { results: T[]; next: string | null } = await ph(next);
    out.push(...page.results.filter((r) => !r.deleted));
    next = page.next ? page.next.replace(/^.*\/api\/projects\/[^/]+/, "") : null;
  }
  return out;
}

/** Creates or updates by name; in dry-run, only says what it would do. */
async function upsert(kind: string, path: string, existing: Named[], body: { name: string } & Record<string, unknown>): Promise<number> {
  const found = existing.find((e) => e.name === body.name);
  if (!apply) {
    console.log(`${found ? "actualizar" : "crear"} ${kind}: ${body.name}`);
    return found?.id ?? -(existing.length + 1);
  }
  const saved = found
    ? await ph<Named>(`${path}${found.id}/`, { method: "PATCH", body })
    : await ph<Named>(path, { method: "POST", body });
  console.log(`${found ? "actualizado" : "creado"} ${kind} #${saved.id}: ${body.name}`);
  return saved.id;
}

async function main() {
  if (!apply) console.log("Modo prueba: no se cambia nada. Agregá --apply para crear o actualizar.\n");
  const dryOffline = !apply && !process.env.POSTHOG_PERSONAL_API_KEY;
  if (dryOffline) console.log("(Sin POSTHOG_PERSONAL_API_KEY: se muestra lo que se crearía, sin consultar el proyecto.)\n");

  if (rename) {
    if (apply) {
      await ph("/", { method: "PATCH", body: { name: rename } });
      console.log(`Proyecto renombrado a «${rename}».`);
    } else console.log(`renombrar el proyecto a «${rename}»`);
  }

  const actions = dryOffline ? [] : await all<Named>("/actions/");
  const actionIds = new Map<string, number>();
  for (const a of ACTIONS) actionIds.set(a.name, await upsert("acción", "/actions/", actions, actionBody(a)));

  const dashboards = dryOffline ? [] : await all<Named>("/dashboards/");
  const insights = dryOffline ? [] : (await all<Named>("/insights/?saved=true")).filter((i) => i.tags?.includes(SETUP_TAG));
  for (const d of DASHBOARDS) {
    const dashboardId = await upsert("tablero", "/dashboards/", dashboards, { name: d.name, description: d.description, tags: [SETUP_TAG] });
    for (const def of d.insights) {
      // The same insight name can repeat across dashboards: it is found inside its own dashboard's name.
      const name = `${def.name} · ${d.name.replace(/^habita · /, "")}`;
      const query = queryOf(def, actionIds);
      if (!apply && process.env.POSTHOG_DEBUG) console.log(JSON.stringify(query, null, 2));
      await upsert("gráfico", "/insights/", insights, { name, description: def.description, query, dashboards: [dashboardId], tags: [SETUP_TAG], saved: true });
    }
  }
  console.log(`\n${apply ? "Listo" : "Prueba terminada"}: ${ACTIONS.length} acciones, ${DASHBOARDS.length} tableros, ${DASHBOARDS.reduce((n, d) => n + d.insights.length, 0)} gráficos.`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
