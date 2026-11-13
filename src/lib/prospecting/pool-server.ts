import "server-only";
import { HttpError } from "@/lib/commerce/http";
import { isUuid } from "@/lib/demos/shared";
import { adminClient } from "@/lib/supabase/server";
import { normalizeWhatsapp } from "./import";
import {
  autoStatus, cleanProfile, completeness, DEMO_PATH_LABEL, demoBlock, demoPathOf, EXPLORE_SHARE, FIELDS, GROUPS, learnings, MANUAL_SHARE, MIN_FIT,
  missingForQueue, outcomesOf, pickForQueue, scoreOf, SCORING_VERSION, STATUS_HELP, STATUS_LABEL, variables, WEIGHTS, whatsappOf,
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
  const demoPath = demoPathOf(vars);
  return { vars, inferred, score, complete, wa, legacy, missing, status, demoPath };
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
        demoPath: d.demoPath,
        demoPathLabel: DEMO_PATH_LABEL[d.demoPath],
        // Ya en la cola con un aviso que no se importa: se avisa, sin sacarla sola (eso lo decide el equipo).
        warnings: d.status === "en_cola" && !d.legacy && d.demoPath === "bloqueado" ? [demoBlock(a, d.vars)!] : [],
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
      manualShare: MANUAL_SHARE,
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
async function persist(actor: string, account: ProspectAccount, row: ProfileRow | undefined, extra: Extra | undefined, changes: Record<string, unknown>, force: Partial<{ status: PoolStatus; discard_reason: string; explore: boolean }> = {}) {
  const profile = { ...(row?.profile ?? {}) } as Record<string, unknown>;
  for (const [k, v] of Object.entries(changes)) {
    if (v === null) delete profile[k];
    else profile[k] = v;
  }
  // Sin perfil y con WhatsApp es una cuenta de antes de Prospectos: ya estaba en la cola.
  const before: PoolStatus = row?.status ?? (whatsappOf(account) ? "en_cola" : "descubierto");
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

const normalized = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const host = (url: string | null) => {
  try {
    return url ? new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).hostname.replace(/^www\./, "").toLowerCase() : "";
  } catch {
    return "";
  }
};

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
          return { id: a.id, score: d.score.total, status: d.status, hardReady: Boolean(d.wa) && (d.demoPath === "importar" || d.demoPath === "manual"), manual: d.demoPath === "manual" };
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
      const same = ds.accounts.find(
        (a) =>
          normalized(a.name) === normalized(name) ||
          (website && host(a.website) && host(a.website) === host(website)) ||
          (wa?.address && a.contacts.some((c) => c.address === wa.address)),
      );
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
