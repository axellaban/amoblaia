// Prospectos: dejar listo lo que necesita «Crear demo», para que la extensión no tenga que buscar.
//
// 1. Al guardar un aviso (el principal o una precarga) se lo lee de prueba, con el mismo lector de
//    las importaciones y sin crear nada: si se puede importar, con cuántas fotos, o por qué no.
// 2. Cuando la inmobiliaria pasa a Interesado (la cola le pone «Crear demo»), los tres avisos se
//    importan a su panel como «Lista para importar»: datos guardados y fotos pendientes, sin
//    ambientar nada ni usar créditos. La extensión abre la principal, importa sus fotos y sigue;
//    las otras dos le quedan a la inmobiliaria para importarlas con un clic.
import "server-only";
import { createHash } from "node:crypto";
import { importListing } from "@/lib/agency/import-flow";
import { HttpError, isAdmin } from "@/lib/commerce/http";
import { readListing, readSiblingListings } from "@/lib/demos/listing";
import { demoPrepTargets } from "@/lib/followup/server";
import { adminClient } from "@/lib/supabase/server";
import {
  checkOf, listingsOf, missingPreloads, preloadSearchDue, prepDue, sameListing, uncheckedListings,
  type DemoPrep, type DemoPrepItem, type ListingCheck, type ListingChecks, type Profile,
} from "./pool";

const MIGRATION = "Falta aplicar en Supabase 202612280001_prospect_demo_prep.sql (avisos de la demo).";
type Row = { account_id: string; status: string; profile: Profile | null; listing_checks: ListingChecks | null; demo_prep: DemoPrep | null };
const COLUMNS = "account_id,status,profile,listing_checks,demo_prep";

async function rowOf(accountId: string) {
  const { data, error } = await adminClient().from("prospect_profiles").select(COLUMNS).eq("account_id", accountId).maybeSingle();
  if (error) throw new HttpError(503, MIGRATION);
  return (data as Row | null) ?? null;
}

/** Leer el aviso como lo haría la importación, sin crear nada. */
export async function probeListing(url: string): Promise<ListingCheck> {
  const at = new Date().toISOString();
  try {
    const read = await readListing(url);
    const photos = read.imported.images.length;
    const title = read.imported.title?.slice(0, 160) || null;
    return photos ? { ok: true, photos, title, error: null, at } : { ok: false, photos: 0, title, error: "La publicación no trae fotos.", at };
  } catch (e) {
    return { ok: false, photos: 0, title: null, error: e instanceof Error ? e.message.slice(0, 240) : "No se pudo leer la publicación.", at };
  }
}

/** Lee de prueba los avisos de una inmobiliaria: los que faltan o, con `force`, todos. Guarda solo los de ahora. */
export async function checkListings(accountId: string, { force = false } = {}) {
  const row = await rowOf(accountId);
  if (!row) throw new HttpError(404, "Esa inmobiliaria todavía no tiene datos en Prospectos.");
  const profile = row.profile ?? {};
  const targets = force ? listingsOf(profile) : uncheckedListings(profile, row.listing_checks);
  const checks: ListingChecks = {};
  // Only the current listings are kept: an old one replaced in the form is forgotten.
  for (const l of listingsOf(profile)) {
    const prev = checkOf(row.listing_checks, l.url);
    if (prev) checks[l.url] = prev;
  }
  for (const l of targets) checks[l.url] = await probeListing(l.url);
  if (targets.length) {
    const { error } = await adminClient().from("prospect_profiles").update({ listing_checks: checks }).eq("account_id", accountId);
    if (error) throw new HttpError(503, MIGRATION);
  }
  return { checked: targets.length, checks };
}

/** Las que tienen avisos sin leer, primero las que están por entrar o ya entraron a la cola. */
export async function checkPendingListings({ limit = 20, deadline = Date.now() + 60_000 } = {}) {
  const { data, error } = await adminClient().from("prospect_profiles").select(COLUMNS).neq("status", "descartado").limit(5000);
  if (error) return { checked: 0, accounts: 0 };
  const order: Record<string, number> = { en_cola: 0, calificado: 1, enriquecido: 2, descubierto: 3 };
  const due = ((data ?? []) as Row[])
    .filter((r) => uncheckedListings(r.profile ?? {}, r.listing_checks).length)
    .sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9));
  let checked = 0, accounts = 0;
  for (const r of due) {
    if (accounts >= limit || Date.now() > deadline) break;
    checked += (await checkListings(r.account_id).catch(() => ({ checked: 0 }))).checked;
    accounts++;
  }
  return { checked, accounts };
}

/** Una precarga encontrada sola: con fotos suficientes para mostrar algo. */
const MIN_PRELOAD_PHOTOS = 3;

/**
 * Las precargas que faltan, buscadas en la página del aviso principal (su web propia): los enlaces
 * con forma de aviso del mismo sitio se leen de prueba y se guardan los primeros que se importan,
 * con fotos y distintos de los otros. Se busca una vez por aviso principal; «Comprobar avisos»
 * lo vuelve a habilitar. Lo que se guarda queda en Prospectos como si se hubiera cargado a mano.
 */
export async function findPreloads(accountId: string, { deadline = Date.now() + 90_000 } = {}): Promise<string[]> {
  const row = await rowOf(accountId);
  if (!row || !preloadSearchDue(row.profile ?? {}, row.listing_checks)) return [];
  const profile = row.profile ?? {};
  const main = String(profile.demo_listing_url);
  const taken = listingsOf(profile);
  const titles = new Set(taken.map((l) => checkOf(row.listing_checks, l.url)?.title?.trim().toLowerCase()).filter(Boolean));
  const free = missingPreloads(profile);
  const found: { url: string; check: ListingCheck }[] = [];
  const candidates = await readSiblingListings(main).catch(() => [] as string[]);
  for (const url of candidates) {
    if (found.length >= free.length || Date.now() > deadline) break;
    if (taken.some((l) => sameListing(l.url, url)) || found.some((f) => sameListing(f.url, url))) continue;
    const check = await probeListing(url);
    const title = check.title?.trim().toLowerCase();
    if (!check.ok || check.photos < MIN_PRELOAD_PHOTOS || (title && titles.has(title))) continue;
    if (title) titles.add(title);
    found.push({ url, check });
  }
  // Read again before writing: a precarga typed in Prospectos meanwhile wins.
  const now = await rowOf(accountId);
  if (!now || !sameListing(now.profile?.demo_listing_url, main)) return [];
  const nextProfile: Profile = { ...(now.profile ?? {}) };
  const checks: ListingChecks = { ...(now.listing_checks ?? {}) };
  const saved: string[] = [];
  for (const key of missingPreloads(nextProfile)) {
    const f = found.shift();
    if (!f) break;
    nextProfile[key] = f.url;
    checks[f.url] = f.check;
    saved.push(f.url);
  }
  const mainKey = Object.keys(checks).find((u) => sameListing(u, main));
  if (mainKey) checks[mainKey] = { ...checks[mainKey], searched: new Date().toISOString() };
  const { error } = await adminClient().from("prospect_profiles").update({ profile: nextProfile, listing_checks: checks }).eq("account_id", accountId);
  if (error) throw new HttpError(503, MIGRATION);
  return saved;
}

/** Las de la cola a las que les faltan precargas: se buscan en su web (primero las que ya entraron). */
export async function findPendingPreloads({ limit = 10, deadline = Date.now() + 60_000 } = {}) {
  const { data, error } = await adminClient().from("prospect_profiles").select(COLUMNS).in("status", ["en_cola", "calificado"]).limit(5000);
  if (error) return { found: 0, accounts: 0 };
  const due = ((data ?? []) as Row[])
    .filter((r) => preloadSearchDue(r.profile ?? {}, r.listing_checks))
    .sort((a, b) => (a.status === "en_cola" ? 0 : 1) - (b.status === "en_cola" ? 0 : 1));
  let found = 0, accounts = 0;
  for (const r of due) {
    if (accounts >= limit || Date.now() > deadline) break;
    found += (await findPreloads(r.account_id, { deadline: Math.min(deadline, Date.now() + 60_000) }).catch(() => [])).length;
    accounts++;
  }
  return { found, accounts };
}

/**
 * Una propiedad que se dejó en su panel por un aviso que después se cambió en Prospectos: se saca
 * si sigue intacta (sin fotos y sin publicar). Si alguien ya trabajó en ella, se deja.
 */
async function removeUntouched(agencyId: string, demoId: string, actorId: string) {
  const db = adminClient();
  const { data } = await db.from("demos").select("id,property_id,agency_id,status").eq("id", demoId).maybeSingle();
  const demo = data as { id: string; property_id: string; agency_id: string; status: string } | null;
  if (!demo || demo.agency_id !== agencyId || demo.status !== "draft") return false;
  const { count, error } = await db.from("demo_photos").select("id", { count: "exact", head: true }).eq("property_id", demo.property_id);
  if (error || (count ?? 0) > 0) return false;
  await db.from("property_imports").update({ status: "failed", pending_images: [], error: "Se cambió el aviso en Prospectos." }).eq("demo_id", demoId);
  const removed = await db.from("demo_properties").delete().eq("id", demo.property_id);
  if (removed.error) return false;
  await db.from("admin_audit").insert({ actor_id: actorId, action: "prospect_prep_removed", subject_id: demoId, details: { agencyId } });
  return true;
}

/** «Dejar en su panel» a mano: solo con la tarea «Crear demo» pendiente (mostró interés y no tiene demo). */
export async function assertCreateDemo(agencyId: string) {
  if ((await demoPrepTargets()).some((t) => t.agencyId === agencyId)) return;
  throw new HttpError(409, "Todavía no está en «Crear demo». Sus avisos quedan en su panel cuando muestre interés: antes, la inmobiliaria vería propiedades que no pidió.");
}

/** Una clave por inmobiliaria, aviso e intento: el mismo intento repetido no importa dos veces. */
function requestKey(agencyId: string, url: string, attempt: number) {
  const h = createHash("sha256").update(`${agencyId}|${url}|${attempt}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/** Importa a su panel los avisos que faltan («Lista para importar») y guarda qué pasó con cada uno. */
export async function prepareDemo(accountId: string, agencyId: string, actorId: string, by: string): Promise<DemoPrep> {
  let row = await rowOf(accountId);
  if (!row) throw new HttpError(404, "Esa inmobiliaria todavía no tiene datos en Prospectos.");
  // Missing precargas: looked for on its own site first, so the three go to its panel together.
  const found = preloadSearchDue(row.profile ?? {}, row.listing_checks) ? await findPreloads(accountId).catch(() => [] as string[]) : [];
  if (found.length) row = (await rowOf(accountId)) ?? row;
  const profile = row.profile ?? {};
  const listings = listingsOf(profile);
  if (!listings.length) throw new HttpError(409, "Falta el aviso para la demo en Prospectos.");
  const prev = row.demo_prep;
  const attempt = (prev?.attempts ?? 0) + 1;
  const items: DemoPrepItem[] = [];
  for (const l of listings) {
    const done = prev?.items.find((i) => i.ok && sameListing(i.url, l.url));
    if (done) { items.push({ ...done, key: l.key }); continue; }
    const check = checkOf(row.listing_checks, l.url);
    if (check && !check.ok) { items.push({ key: l.key, url: l.url, ok: false, demoId: null, photos: 0, error: `No se puede importar: ${check.error ?? "no se pudo leer"}` }); continue; }
    const request = new Request("https://habita.internal/prospectos/preparar", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: l.url, key: requestKey(agencyId, l.url, attempt) }),
    });
    const res = await importListing(request, { agencyId, userId: actorId, origin: "admin" });
    const body = (await res.json().catch(() => ({}))) as { id?: string; photosTotal?: number; duplicateOf?: string; error?: string };
    if (res.ok && body.id) items.push({ key: l.key, url: l.url, ok: true, demoId: body.id, photos: body.photosTotal ?? 0, error: null });
    else if (res.status === 409 && body.duplicateOf) items.push({ key: l.key, url: l.url, ok: true, demoId: body.duplicateOf, photos: 0, error: null });
    else items.push({ key: l.key, url: l.url, ok: false, demoId: null, photos: 0, error: (body.error ?? `Error ${res.status}`).slice(0, 240) });
  }
  // A property left by a listing changed since in Prospectos: out of its panel, if nobody worked on it.
  const removed: string[] = [...(prev?.removed ?? [])];
  for (const old of prev?.items ?? []) {
    if (!old.ok || !old.demoId || listings.some((l) => sameListing(l.url, old.url))) continue;
    if (await removeUntouched(agencyId, old.demoId, actorId).catch(() => false)) removed.push(old.url);
  }
  const prep: DemoPrep = {
    at: new Date().toISOString(), attempts: attempt, by, items,
    ...(found.length || prev?.found?.length ? { found: [...(prev?.found ?? []), ...found] } : {}),
    ...(removed.length ? { removed } : {}),
  };
  const { error } = await adminClient().from("prospect_profiles").update({ demo_prep: prep }).eq("account_id", accountId);
  if (error) throw new HttpError(503, MIGRATION);
  return prep;
}

/**
 * Las que la cola tiene en «Crear demo» y todavía no tienen sus avisos en el panel: se preparan.
 * Si la extensión ya cargó propiedades a mano, no se toca nada.
 */
export async function prepareInterested({ actorId: given, by = "Preparación automática", limit = 5, deadline = Date.now() + 60_000 }: { actorId: string | null; by?: string; limit?: number; deadline?: number }) {
  // The imports are made in the name of a team member: PROSPECTING_ACTOR_ID or, without it, the first admin.
  const actorId = given ?? (await teamActor());
  if (!actorId) return { prepared: 0 };
  const targets = (await demoPrepTargets()).filter((t) => t.properties === 0 || t.prepared);
  if (!targets.length) return { prepared: 0 };
  const { data: accounts } = await adminClient().from("prospect_accounts").select("id,agency_id").in("agency_id", targets.map((t) => t.agencyId));
  const ids = ((accounts ?? []) as { id: string; agency_id: string }[]);
  const { data, error } = await adminClient().from("prospect_profiles").select(COLUMNS).in("account_id", ids.map((a) => a.id));
  if (error) return { prepared: 0 };
  let prepared = 0;
  for (const r of (data ?? []) as Row[]) {
    if (prepared >= limit || Date.now() > deadline) break;
    if (!prepDue(r.profile ?? {}, r.demo_prep)) continue;
    const agencyId = ids.find((a) => a.id === r.account_id)?.agency_id;
    if (!agencyId) continue;
    await prepareDemo(r.account_id, agencyId, actorId, by).catch((e) => console.error("prospect_demo_prep_failed", e instanceof Error ? e.message : e));
    prepared++;
  }
  return { prepared };
}

let cachedActor: string | null = null;
async function teamActor() {
  if (cachedActor) return cachedActor;
  const { data } = await adminClient().auth.admin.listUsers({ page: 1, perPage: 1000 }).catch(() => ({ data: null }));
  cachedActor = (data?.users ?? []).find((u) => isAdmin(u.email))?.id ?? null;
  return cachedActor;
}

let sweptAt = 0;
/** En segundo plano, después de responder (Follow-up de Chapa): como mucho una vez por minuto por instancia. */
export async function sweepDemoPrep(actorId: string | null) {
  if (Date.now() - sweptAt < 60_000) return;
  sweptAt = Date.now();
  await prepareInterested({ actorId, limit: 2, deadline: Date.now() + 120_000 });
}
