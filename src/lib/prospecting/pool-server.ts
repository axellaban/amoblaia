import "server-only";
import { HttpError } from "@/lib/commerce/http";
import { isUuid } from "@/lib/demos/shared";
import { adminClient } from "@/lib/supabase/server";
import { normalizeWhatsapp } from "./import";
import {
  autoStatus, cleanProfile, completeness, CONFIDENCE_TEXT, EXPLORE_SHARE, FIELDS, GROUPS, learnings, MIN_FIT, missingForQueue, outcomesOf, pickForQueue,
  sameAccount, scoreOf, SCORING_VERSION, STATUS_HELP, STATUS_LABEL, variables, WEIGHTS, whatsappOf,
  type Extra, type LearnRow, type PoolStatus, type Profile, type Score,
} from "./pool";
import { ProspectError, prospectDataset, prospectRpc } from "./server";
import type { Dataset, ProspectAccount } from "./types";

type ProfileRow = {
  account_id: string;
  status: PoolStatus;
  discard_reason: string | null;
  profile: Profile;
  score: number | null;
  score_components: Record<string, unknown>;
  scoring_version: string | null;
  explore: boolean;
  queued_at: string | null;
  queue_snapshot: { profile?: Profile; score?: number } | null;
  updated_at: string;
};
type PoolData = { profiles: ProfileRow[]; extra: ({ account_id: string } & Extra)[] };

/** Los perfiles, o `null` si falta la migración (la vista lo avisa y el resto del panel sigue). */
async function poolData(): Promise<PoolData | null> {
  try {
    return await prospectRpc<PoolData>("habita_prospect_pool");
  } catch (e) {
    if (e instanceof ProspectError && e.code === "MIGRATION_MISSING") return null;
    throw e;
  }
}

/**
 * El estado de cada cuenta con perfil y su ranking, para la cola de Follow-up. Sin la migración,
 * o si la lectura falla, devuelve vacío: la cola sigue como siempre.
 */
export async function poolGates(): Promise<Map<string, { status: PoolStatus; score: number | null }>> {
  const out = new Map<string, { status: PoolStatus; score: number | null }>();
  for (let from = 0; from < 50000; from += 1000) {
    const { data, error } = await adminClient().from("prospect_profiles").select("account_id,status,score").range(from, from + 999);
    if (error) return new Map();
    for (const r of (data ?? []) as { account_id: string; status: PoolStatus; score: number | string | null }[])
      out.set(r.account_id, { status: r.status, score: r.score === null ? null : Number(r.score) });
    if ((data ?? []).length < 1000) break;
  }
  return out;
}

/** El primer mensaje que recibió cada inmobiliaria: la versión del saludo de Follow-up o, si vino de la planilla, «Histórico». */
async function firstMessages(ds: Dataset) {
  const out = new Map<string, string>();
  const first = new Map<string, { at: string; label: string }>();
  for (const t of ds.attempts) {
    if (t.status !== "sent" || !t.sent_at) continue;
    const prev = first.get(t.account_id);
    if (!prev || t.sent_at < prev.at) first.set(t.account_id, { at: t.sent_at, label: t.legacy ? "Histórico (planilla)" : t.variant_label?.trim() || "Sin versión" });
  }
  for (const [id, f] of first) out.set(id, f.label);
  try {
    const db = adminClient();
    const [{ data: vs }, { data: ex }] = await Promise.all([
      db.from("followup_versions").select("id,version,stage,action").eq("stage", "no-contactado"),
      db.from("followup_executions").select("agency_id,version_id,sent_at").eq("stage", "no-contactado").eq("status", "sent").range(0, 9999),
    ]);
    const version = new Map(((vs ?? []) as { id: string; version: number; action: string | null }[]).map((v) => [v.id, v]));
    const account = new Map(ds.accounts.map((a) => [a.agency_id, a.id]));
    for (const e of (ex ?? []) as { agency_id: string; version_id: string }[]) {
      const v = version.get(e.version_id);
      const id = account.get(e.agency_id);
      if (v && id && (v.action ?? "principal") === "principal") out.set(id, `Saludo V${v.version}`);
    }
  } catch {
    // Sin Follow-up, queda lo que dice Adquisición.
  }
  return out;
}

const roundScore = (s: Score) => ({ total: s.total, contact: s.contact, fit: s.fit, demo: s.demo, parts: s.parts, caps: s.caps });

function describe(a: ProspectAccount, row: ProfileRow | undefined, extra: Extra | undefined) {
  const { vars, inferred } = variables(a, row?.profile ?? {}, extra);
  const score = scoreOf(a, vars);
  const complete = completeness(vars);
  const wa = whatsappOf(a);
  // Sin perfil es una cuenta de antes de Prospectos: si tiene WhatsApp ya está en la cola, como siempre.
  const legacy = !row;
  const current: PoolStatus | null = row?.status ?? (wa ? "en_cola" : null);
  const missing = missingForQueue(a, vars, score, row?.explore ?? false);
  const status = autoStatus(current, missing, complete);
  return { vars, inferred, score, complete, wa, legacy, missing, status };
}

const contacted = (ds: Dataset) => new Set(ds.attempts.filter((t) => t.status === "sent").map((t) => t.account_id));

/** La vista Prospectos: las pendientes con su ranking y lo que les falta, el catálogo de datos y los aprendizajes. */
export async function poolView(message: string | null = null) {
  const [ds, data] = await Promise.all([prospectDataset({ syncConversions: false }), poolData()]);
  const profiles = new Map((data?.profiles ?? []).map((p) => [p.account_id, p]));
  const extras = new Map((data?.extra ?? []).map((x) => [x.account_id, x]));
  const sent = contacted(ds);
  const outcomes = outcomesOf(ds);
  const messages = await firstMessages(ds);

  const rows = ds.accounts
    .filter((a) => a.stage === "pending" && !sent.has(a.id))
    .map((a) => {
      const row = profiles.get(a.id);
      const extra = extras.get(a.id);
      const d = describe(a, row, extra);
      return {
        id: a.id,
        agencyId: a.agency_id,
        name: a.name,
        website: a.website,
        zone: a.zone,
        address: extra?.address ?? null,
        sdr: a.sdr,
        decisor: a.decision_maker,
        whatsapp: d.wa?.address ?? null,
        whatsappState: d.wa ? (d.wa.needs_review ? "revisar" : "verificado") : a.contacts.some((c) => c.channel === "whatsapp" && c.invalid) ? "invalido" : "",
        status: d.status,
        legacy: d.legacy,
        discardReason: row?.discard_reason ?? null,
        explore: row?.explore ?? false,
        queuedAt: row?.queued_at ?? null,
        score: roundScore(d.score),
        sheetScore: a.score,
        complete: Math.round(d.complete * 100),
        missing: d.status === "en_cola" || d.status === "descartado" ? [] : d.missing,
        profile: row?.profile ?? {},
        inferred: Object.fromEntries(d.inferred.map((k) => [k, d.vars[k]])),
        notes: extra?.source_notes ?? null,
        suppressed: a.suppressed,
        createdAt: a.created_at,
      };
    })
    .sort((x, y) => y.score.total - x.score.total || x.name.localeCompare(y.name));

  const learnRows: LearnRow[] = ds.accounts.map((a) => {
    const row = profiles.get(a.id);
    // Lo que se sabía al entrar a la cola, si quedó la foto; si no, lo que se sabe hoy.
    const snapshot = row?.queue_snapshot?.profile;
    const { vars } = variables(a, snapshot ?? row?.profile ?? {}, extras.get(a.id));
    return {
      account: a,
      vars,
      outcome: outcomes.get(a.id)!,
      score: row?.queue_snapshot?.score ?? null,
      sheetScore: a.score,
      explore: row?.explore ?? false,
      message: messages.get(a.id) ?? null,
    };
  });
  const allMessages = [...new Set(learnRows.filter((r) => r.outcome.attempted && r.message).map((r) => r.message!))].sort();

  const counts = { total: rows.length } as Record<string, number>;
  for (const r of rows) counts[r.status] = (counts[r.status] ?? 0) + 1;

  return {
    available: Boolean(data),
    rows,
    counts,
    catalog: {
      groups: GROUPS,
      fields: FIELDS,
      statuses: (Object.keys(STATUS_LABEL) as PoolStatus[]).map((key) => ({ key, label: STATUS_LABEL[key], help: STATUS_HELP[key] })),
      scoringVersion: SCORING_VERSION,
      weights: WEIGHTS,
      minFit: MIN_FIT,
      exploreShare: EXPLORE_SHARE,
    },
    learning: { ...learnings(learnRows, ds.settings?.small_sample ?? 30, message), message, messages: allMessages },
  };
}

type Op = Record<string, unknown>;
const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

async function load(accountId: unknown) {
  if (!isUuid(accountId)) throw new HttpError(404, "No encontramos esa inmobiliaria en Prospectos.");
  const [ds, data] = await Promise.all([prospectDataset({ syncConversions: false }), poolData()]);
  if (!data) throw new ProspectError(503, "Falta aplicar la migración de Prospectos (202612140001_prospect_pool.sql) en Supabase.", "MIGRATION_MISSING");
  const account = ds.accounts.find((a) => a.id === accountId);
  if (!account) throw new HttpError(404, "No encontramos esa inmobiliaria en Prospectos.");
  return { ds, account, row: data.profiles.find((p) => p.account_id === account.id), extra: data.extra.find((x) => x.account_id === account.id) };
}

const savePool = (actor: string, account: string, patch: Record<string, unknown>) =>
  prospectRpc<ProfileRow>("habita_prospect_pool_save", { p_actor: actor, p_account: account, p_patch: patch });

/** Guarda con el ranking recalculado y el estado que sale de los datos. */
async function persist(actor: string, account: ProspectAccount, row: ProfileRow | undefined, extra: Extra | undefined, changes: Record<string, unknown>, force: Partial<{ status: PoolStatus; discard_reason: string; explore: boolean; from: PoolStatus }> = {}) {
  const profile = { ...(row?.profile ?? {}) } as Record<string, unknown>;
  for (const [k, v] of Object.entries(changes)) {
    if (v === null) delete profile[k];
    else profile[k] = v;
  }
  // Sin perfil y con WhatsApp es una cuenta de antes de Prospectos: ya estaba en la cola.
  const before: PoolStatus = row?.status ?? force.from ?? (whatsappOf(account) ? "en_cola" : "descubierto");
  const explore = force.explore ?? row?.explore ?? false;
  const { vars } = variables(account, profile as Profile, extra);
  const score = scoreOf(account, vars);
  const missing = missingForQueue(account, vars, score, explore);
  const status = force.status ?? autoStatus(before, missing, completeness(vars));
  const patch: Record<string, unknown> = {
    profile: changes,
    status,
    score: score.total,
    score_components: { contact: score.contact, fit: score.fit, demo: score.demo, parts: score.parts, caps: score.caps },
    scoring_version: SCORING_VERSION,
    explore,
  };
  if (status === "descartado") patch.discard_reason = force.discard_reason ?? row?.discard_reason ?? "";
  // La foto de lo que se sabía al entrar a la cola: contra eso se mide después.
  if (status === "en_cola" && before !== "en_cola")
    patch.snapshot = { at: new Date().toISOString(), profile: vars, score: score.total, components: patch.score_components, scoring_version: SCORING_VERSION, explore };
  return { saved: await savePool(actor, account.id, patch), missing, score };
}

/**
 * Las operaciones de la vista Prospectos, para el panel de Chapa Labs:
 *   guardar    { cuenta, valores, zona?, decisor? }   carga datos y recalcula ranking y estado
 *   cola       { cuenta, explorar? }                  la pasa a la cola (si cumple lo que falta)
 *   sacar      { cuenta }                             la saca de la cola (vuelve a Prospectos)
 *   descartar  { cuenta, motivo }                     no se la contacta
 *   reabrir    { cuenta }                             vuelve de descartada
 *   llenar     { cantidad }                           suma a la cola las mejores + exploración
 *   crear      { nombre, web?, zona?, whatsapp?, valores?, confirmar? }
 *   recalcular                                        rehace el ranking de todas con perfil
 *   enriquecer { filas, lote? }                       carga un relevamiento en tanda (ver `enrich`)
 */
export async function runPoolOp(op: unknown, b: Op, actor: { id: string; name: string }) {
  switch (op) {
    case "guardar": {
      const { account, row, extra } = await load(b.cuenta);
      const { patch, errors } = cleanProfile(b.valores ?? {});
      if (errors.length) throw new HttpError(400, errors.join(" "));
      const fields: Record<string, unknown> = {};
      if (typeof b.zona === "string") fields.zone = str(b.zona, 120) || null;
      if (typeof b.decisor === "string") fields.decision_maker = str(b.decisor, 160) || null;
      if (!Object.keys(patch).length && !Object.keys(fields).length) throw new HttpError(400, "No hay cambios.");
      if (Object.keys(fields).length) await prospectRpc("habita_prospect_update", { p_actor: actor.id, p_account: account.id, p_version: account.version, p_patch: fields });
      const { missing, score } = await persist(actor.id, account, row, extra, patch);
      return { ok: true, missing, score: score.total };
    }
    case "cola": {
      const { account, row, extra } = await load(b.cuenta);
      if (account.stage !== "pending") throw new HttpError(409, "Esa inmobiliaria ya fue contactada.");
      const explore = b.explorar === true;
      const { vars } = variables(account, row?.profile ?? {}, extra);
      const missing = missingForQueue(account, vars, scoreOf(account, vars), explore);
      if (missing.length) throw new HttpError(409, `Todavía no puede entrar a la cola. ${missing.join(" ")}`);
      await persist(actor.id, account, row, extra, {}, { status: "en_cola", explore });
      return { ok: true };
    }
    case "sacar":
    case "reabrir": {
      const { account, row, extra } = await load(b.cuenta);
      // De vuelta a Prospectos: el estado sale de los datos.
      const { vars } = variables(account, row?.profile ?? {}, extra);
      const status = autoStatus("descubierto", missingForQueue(account, vars, scoreOf(account, vars)), completeness(vars));
      await persist(actor.id, account, row, extra, {}, { status, explore: false });
      return { ok: true, status };
    }
    case "descartar": {
      const { account, row, extra } = await load(b.cuenta);
      const reason = str(b.motivo, 300);
      if (!reason) throw new HttpError(400, "Indicá por qué se descarta.");
      await persist(actor.id, account, row, extra, {}, { status: "descartado", discard_reason: reason, explore: false });
      return { ok: true };
    }
    case "llenar": {
      const count = Number(b.cantidad);
      if (!Number.isInteger(count) || count < 1 || count > 100) throw new HttpError(400, "Indicá cuántas sumar a la cola (de 1 a 100).");
      const [ds, data] = await Promise.all([prospectDataset({ syncConversions: false }), poolData()]);
      if (!data) throw new ProspectError(503, "Falta aplicar la migración de Prospectos (202612140001_prospect_pool.sql) en Supabase.", "MIGRATION_MISSING");
      const profiles = new Map(data.profiles.map((p) => [p.account_id, p]));
      const extras = new Map(data.extra.map((x) => [x.account_id, x]));
      const sent = contacted(ds);
      const pending = ds.accounts.filter((a) => a.stage === "pending" && !sent.has(a.id) && !a.suppressed);
      const described = new Map(pending.map((a) => [a.id, describe(a, profiles.get(a.id), extras.get(a.id))]));
      const pick = pickForQueue(
        pending.map((a) => {
          const d = described.get(a.id)!;
          return { id: a.id, score: d.score.total, status: d.status, hardReady: Boolean(d.wa) && Boolean(d.vars.demo_listing_url) };
        }),
        count,
      );
      const added: { id: string; name: string; explore: boolean }[] = [];
      for (const [ids, explore] of [[pick.top, false], [pick.explore, true]] as const)
        for (const id of ids) {
          const a = pending.find((x) => x.id === id)!;
          await persist(actor.id, a, profiles.get(id), extras.get(id), {}, { status: "en_cola", explore });
          added.push({ id, name: a.name, explore });
        }
      return { ok: true, added, asked: count };
    }
    case "crear": {
      const name = str(b.nombre, 120);
      if (!name) throw new HttpError(400, "Escribí el nombre de la inmobiliaria.");
      const website = str(b.web, 300) || null;
      const { patch, errors } = cleanProfile(b.valores ?? {});
      if (errors.length) throw new HttpError(400, errors.join(" "));
      const phone = str(b.whatsapp, 60);
      const wa = phone ? normalizeWhatsapp(phone, phone) : null;
      if (phone && !wa?.address) throw new HttpError(400, wa?.review ?? "No reconocimos ese WhatsApp.");
      const [ds, data] = await Promise.all([prospectDataset({ syncConversions: false }), poolData()]);
      if (!data) throw new ProspectError(503, "Falta aplicar la migración de Prospectos (202612140001_prospect_pool.sql) en Supabase.", "MIGRATION_MISSING");
      const same = sameAccount(ds.accounts, { name, website, whatsapp: wa?.address });
      if (same && b.confirmar !== true) throw new ProspectError(409, `Ya está en la base como «${same.name}» (mismo nombre, web o WhatsApp).`, "DUPLICATE", same.id);
      const created = await prospectRpc<{ id: string }>("habita_prospect_add", { p_actor: actor.id, p_agency: null, p_name: name, p_website: website, p_sdr: str(b.sdr, 80) || null, p_campaign: null, p_zone: str(b.zona, 120) || null });
      if (wa?.address)
        await prospectRpc("habita_prospect_contact", {
          p_actor: actor.id, p_account: created.id, p_contact: null,
          p_fields: { channel: "whatsapp", address: wa.address, address_original: wa.original, is_primary: true, needs_review: Boolean(wa.review), review_reason: wa.review, source: `Prospectos (${actor.name})` },
        });
      const fresh = (await prospectDataset({ syncConversions: false })).accounts.find((a) => a.id === created.id)!;
      await persist(actor.id, fresh, undefined, undefined, patch, { status: "descubierto" });
      const again = await load(created.id);
      const { missing } = await persist(actor.id, again.account, again.row, again.extra, {});
      return { ok: true, id: created.id, missing };
    }
    case "enriquecer":
      return enrich(b, actor);
    case "recalcular": {
      const [ds, data] = await Promise.all([prospectDataset({ syncConversions: false }), poolData()]);
      if (!data) throw new ProspectError(503, "Falta aplicar la migración de Prospectos (202612140001_prospect_pool.sql) en Supabase.", "MIGRATION_MISSING");
      const extras = new Map(data.extra.map((x) => [x.account_id, x]));
      let changed = 0;
      for (const row of data.profiles) {
        const a = ds.accounts.find((x) => x.id === row.account_id);
        if (!a || a.stage !== "pending") continue;
        await persist(actor.id, a, row, extras.get(a.id), {});
        changed++;
      }
      return { ok: true, changed };
    }
    default:
      throw new HttpError(400, "Operación de Prospectos desconocida.");
  }
}


/**
 * Un relevamiento en tanda (por ejemplo, el de una zona nueva o el de las que no tenían WhatsApp):
 *   filas: [{ cuenta?, nombre, zona?, web?, decisor?, whatsapp?, whatsapp_fuente?, confianza?, valores?, descartar? }]
 *   lote:  nombre de la tanda; queda en «Lote» y se compara en Aprendizajes.
 * Cada fila se busca por `cuenta` o por el mismo nombre, web o WhatsApp; si no existe, se crea. El
 * WhatsApp nuevo entra a revisar (se valida al confirmar el saludo) y una cuenta que no tenía
 * WhatsApp queda en Prospectos: no salta a la cola hasta que se la pasa. Las variables se suman
 * a las que ya tiene y el ranking se recalcula. Una fila con errores no frena a las demás.
 */
async function enrich(b: Op, actor: { id: string; name: string }) {
  const rows = Array.isArray(b.filas) ? (b.filas as Record<string, unknown>[]) : [];
  if (!rows.length || rows.length > 300) throw new HttpError(400, "Mandá entre 1 y 300 filas.");
  const batch = str(b.lote, 80) || null;
  let [ds, data] = await Promise.all([prospectDataset({ syncConversions: false }), poolData()]);
  if (!data) throw new ProspectError(503, "Falta aplicar la migración de Prospectos (202612140001_prospect_pool.sql) en Supabase.", "MIGRATION_MISSING");
  const errors: { fila: number; nombre: string; error: string }[] = [];
  const touched = new Map<string, { patch: Record<string, unknown>; from: PoolStatus | undefined; discard: string | null }>();
  let created = 0;
  let contacts = 0;

  for (const [i, r] of rows.entries()) {
    const name = str(r.nombre, 120);
    try {
      const website = str(r.web, 300) || null;
      const phone = str(r.whatsapp, 60);
      const wa = phone ? normalizeWhatsapp(phone, phone) : null;
      if (phone && !wa?.address) throw new HttpError(400, wa?.review ?? "No reconocimos ese WhatsApp.");
      let account = isUuid(r.cuenta) ? ds.accounts.find((a) => a.id === r.cuenta) ?? null : sameAccount(ds.accounts, { name, website, whatsapp: wa?.address });
      if (!account) {
        if (!name) throw new HttpError(400, "Falta el nombre.");
        const made = await prospectRpc<{ id: string }>("habita_prospect_add", { p_actor: actor.id, p_agency: null, p_name: name, p_website: website, p_sdr: str(r.sdr, 80) || null, p_campaign: null, p_zone: str(r.zona, 120) || null });
        ds = await prospectDataset({ syncConversions: false });
        account = ds.accounts.find((a) => a.id === made.id) ?? null;
        if (!account) throw new HttpError(500, "No se pudo crear la cuenta.");
        created++;
      }
      // Una cuenta de antes de Prospectos con WhatsApp ya estaba en la cola; sin WhatsApp, entra a Prospectos.
      const prior = touched.get(account.id);
      const from = prior?.from ?? (data.profiles.some((p) => p.account_id === account!.id) ? undefined : whatsappOf(account) ? "en_cola" : "descubierto");

      const fields: Record<string, unknown> = {};
      const zone = str(r.zona, 120);
      if (zone && !account.zone) fields.zone = zone;
      const decisor = str(r.decisor, 160);
      if (decisor && !account.decision_maker) fields.decision_maker = decisor;
      if (Object.keys(fields).length) await prospectRpc("habita_prospect_update", { p_actor: actor.id, p_account: account.id, p_version: account.version, p_patch: fields });

      if (wa?.address && !account.contacts.some((c) => c.address === wa.address)) {
        const confidence = str(r.confianza, 40);
        await prospectRpc("habita_prospect_contact", {
          p_actor: actor.id, p_account: account.id, p_contact: null,
          p_fields: {
            channel: "whatsapp", address: wa.address, address_original: wa.original, is_primary: !whatsappOf(account),
            needs_review: true, review_reason: wa.review ?? "Número relevado: confirmá en el chat que es la inmobiliaria.",
            confidence: CONFIDENCE_TEXT[confidence] ?? CONFIDENCE_TEXT.celular_publicado,
            source: `Prospectos · relevamiento${batch ? ` ${batch}` : ""} (${actor.name})`, source_url: str(r.whatsapp_fuente, 500) || null,
          },
        });
        contacts++;
      }

      const { patch, errors: bad } = cleanProfile({ ...((r.valores as Record<string, unknown>) ?? {}), ...(batch ? { source_batch: batch } : {}) });
      // Un dato mal relevado no tira la fila: se guarda lo demás y se avisa.
      if (bad.length) errors.push({ fila: i + 1, nombre: name || account.name, error: bad.join(" ") });
      for (const [k, v] of Object.entries(patch)) if (v === null) delete patch[k];
      touched.set(account.id, { patch: { ...(prior?.patch ?? {}), ...patch }, from, discard: str(r.descartar, 300) || prior?.discard || null });
    } catch (e) {
      errors.push({ fila: i + 1, nombre: name, error: e instanceof Error ? e.message : "Error." });
    }
  }

  // Con todo cargado, el ranking y el estado de cada una.
  [ds, data] = await Promise.all([prospectDataset({ syncConversions: false }), poolData()]);
  const profiles = new Map((data?.profiles ?? []).map((p) => [p.account_id, p]));
  const extras = new Map((data?.extra ?? []).map((x) => [x.account_id, x]));
  const result: { id: string; name: string; status: PoolStatus; score: number; missing: string[] }[] = [];
  for (const [id, t] of touched) {
    const account = ds.accounts.find((a) => a.id === id);
    if (!account) continue;
    const force = t.discard ? { status: "descartado" as const, discard_reason: t.discard } : { from: t.from };
    const { saved, missing, score } = await persist(actor.id, account, profiles.get(id), extras.get(id), t.patch, force);
    result.push({ id, name: account.name, status: saved.status, score: score.total, missing });
  }
  result.sort((x, y) => y.score - x.score);
  return { ok: true, created, contacts, updated: result.length, errors, rows: result };
}
