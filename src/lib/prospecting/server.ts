import "server-only";
import { HttpError } from "@/lib/commerce/http";
import { demoUrl } from "@/lib/demos/shared";
import { adminClient } from "@/lib/supabase/server";
import type { ExistingAgency } from "./import";
import type { Dataset, DemoProgress } from "./types";

/** A refused operation, with a stable code the panel (and an extension) can act on. */
export class ProspectError extends HttpError {
  constructor(
    status: number,
    message: string,
    public code: string,
    public detail: string | null = null,
  ) {
    super(status, message);
  }
}

const ERRORS: Record<string, [number, string]> = {
  ATTEMPT_OPEN: [409, "Esta cuenta ya tiene un intento preparado, abierto o incierto. Resolvelo antes de preparar otro."],
  SUPPRESSED: [409, "Hay una baja vigente para esta cuenta, canal o contacto. No se puede contactar."],
  CONTACT_INVALID: [409, "Ese contacto está marcado como inválido."],
  CONTACT_NEEDS_REVIEW: [409, "El destinatario no está revisado: verificá el número o email en la ficha."],
  RECIPIENT_NOT_REVIEWED: [400, "Confirmá que revisaste el destinatario antes de preparar el intento."],
  RECIPIENT_CHANGED: [409, "El destinatario cambió después de preparar: cancelá y prepará de nuevo."],
  CHANNEL_NOT_SUPPORTED: [400, "Solo se preparan intentos por WhatsApp o email."],
  SEQUENCE_STOPPED: [409, "La cuenta ya respondió: la secuencia está detenida. Seguí como conversación."],
  STEP_ALREADY_SENT: [409, "Ese paso de la secuencia ya se envió a esta cuenta."],
  INVALID_BODY: [400, "Escribí el texto del mensaje (hasta 4000 caracteres)."],
  SUBJECT_REQUIRED: [400, "El email necesita asunto."],
  SENDER_REQUIRED: [400, "Indicá quién envía (SDR o cuenta emisora)."],
  TEMPLATE_NOT_FOUND: [404, "No encontramos esa versión de plantilla."],
  TEMPLATE_MISMATCH: [400, "La plantilla es de otro canal o paso."],
  TEMPLATE_REQUIRED: [400, "Elegí una plantilla o marcá el mensaje como personalizado."],
  TEMPLATE_EXISTS: [409, "Ya hay una plantilla con ese nombre para ese canal y paso."],
  LOCKED: [409, "Otro operador tiene este intento abierto. Esperá a que lo confirme o venza su bloqueo."],
  STALE: [409, "Los datos cambiaron en otra sesión. Actualizá y volvé a intentar."],
  INVALID_STATE: [409, "El intento ya no está en un estado que permita esa acción. Actualizá para ver su estado."],
  INVALID_METHOD: [400, "Elegí cómo verificaste el envío."],
  INVALID_TIME: [400, "La fecha no es válida (no puede ser futura ni anterior a la preparación)."],
  INVALID_OUTCOME: [400, "Resultado no válido."],
  REASON_REQUIRED: [400, "Indicá el motivo."],
  EVIDENCE_REQUIRED: [400, "Indicá la evidencia (qué dijo, dónde y cuándo)."],
  ACCOUNT_NOT_FOUND: [404, "No encontramos la cuenta."],
  AGENCY_NOT_FOUND: [404, "No encontramos la inmobiliaria."],
  CONTACT_NOT_FOUND: [404, "No encontramos el contacto."],
  CONTACT_EXISTS: [409, "Esa dirección ya está cargada para esta cuenta."],
  ATTEMPT_NOT_FOUND: [404, "No encontramos el intento."],
  KEY_REUSED: [409, "La clave de la operación ya se usó para otra cuenta."],
  INVALID_EVENT: [400, "Tipo de registro no válido."],
  EVENT_NOT_FOUND: [404, "No encontramos el registro a corregir."],
  NOT_CORRECTABLE: [400, "Ese registro no se corrige a mano."],
  ALREADY_CORRECTED: [409, "Ese registro ya tiene una corrección."],
  INVALID_SCOPE: [400, "Alcance de baja no válido."],
  SUPPRESSION_NOT_FOUND: [404, "No encontramos esa baja vigente."],
  INVALID_FIELD: [400, "Campo no editable."],
  INVALID_STAGE: [400, "Ese estado surge del historial: registrá el hecho (respuesta, interés, pérdida) en lugar de cambiarlo."],
  INVALID_CHANNEL: [400, "Canal no válido."],
  INVALID_STEP: [400, "Paso no válido."],
  INVALID_NAME: [400, "Escribí el nombre de la inmobiliaria."],
  IMPORT_IN_PROGRESS: [409, "Esa importación se está aplicando. Actualizá en unos segundos."],
  INVALID_SOURCE: [400, "Indicá el origen de la importación."],
  INVALID_ROWS: [400, "La importación no tiene filas válidas o supera 5000."],
};

/** Runs a prospecting RPC as service_role. Only call after requireAdmin. */
export async function prospectRpc<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await adminClient().rpc(name, args);
  if (error) {
    const m = /^([A-Z_]+)(?::(.*))?$/.exec(error.message ?? "");
    if (m && ERRORS[m[1]]) throw new ProspectError(ERRORS[m[1]][0], ERRORS[m[1]][1], m[1], m[2] ?? null);
    if (error.code === "PGRST202" || error.code === "42883" || error.code === "42P01")
      throw new ProspectError(503, "Faltan las migraciones de prospección en Supabase: aplicá 202611010001_prospecting.sql y 202611020001_prospect_import_options.sql.", "MIGRATION_MISSING");
    // A value the database refuses (too long, out of range): say which, instead of a generic failure.
    if (error.code === "23514" || error.code === "22001" || error.code === "22003")
      throw new ProspectError(400, `La base rechazó un valor (${/constraint "([^"]+)"/.exec(error.message ?? "")?.[1] ?? error.code}). No se guardó nada.`, "INVALID_VALUE");
    throw new Error(`DATABASE_${error.code}`);
  }
  return data as T;
}

/** The whole private dataset, after reconciling activation and purchases from the server's tables. */
export async function prospectDataset(): Promise<Dataset> {
  await prospectRpc<number>("habita_prospect_sync_conversions");
  const ds = await prospectRpc<Dataset>("habita_prospect_dataset");
  const agencies = [...new Set(ds.accounts.map((a) => a.agency_id))];
  const progress = await demoProgress(agencies);
  for (const a of ds.accounts) a.demo = progress.get(a.agency_id) ?? { created: false, sent: false, level: 0 };
  return ds;
}

/** Demo steps per agency, from the demos table (published link = sent, activity level = steps reached). */
async function demoProgress(agencyIds: string[]) {
  const out = new Map<string, DemoProgress>();
  if (!agencyIds.length) return out;
  const { data, error } = await adminClient()
    .from("demos")
    .select("agency_id,status,activity_level")
    .in("agency_id", agencyIds);
  if (error) throw new Error(`DATABASE_${error.code}`);
  for (const row of (data ?? []) as { agency_id: string; status: string; activity_level: number }[]) {
    const p = out.get(row.agency_id) ?? { created: false, sent: false, level: 0 as const };
    p.created = true;
    if (row.status === "published") p.sent = true;
    p.level = Math.max(p.level, Math.min(3, Math.max(0, row.activity_level))) as DemoProgress["level"];
    out.set(row.agency_id, p);
  }
  return out;
}

type DemoRow = { id: string; token: string; status: string; published_at: string | null; created_at: string; title: string };
type RawDetail = {
  account: Record<string, unknown> & { agency_id: string };
  agency: { id: string; name: string; website: string | null; linked: boolean; claimedAt: string | null };
  contacts: Record<string, unknown>[];
  events: Record<string, unknown>[];
  attempts: Record<string, unknown>[];
  suppressions: Record<string, unknown>[];
  demos: DemoRow[];
};
export type AccountDetail = Omit<RawDetail, "demos"> & {
  demos: { id: string; status: string; title: string; publishedAt: string | null; url: string | null }[];
};

/** One account with its full history, contacts, attempts, suppressions and demos (public link only when published). */
export async function prospectAccount(id: string, origin: string): Promise<AccountDetail> {
  const d = await prospectRpc<RawDetail | null>("habita_prospect_account", { p_account: id });
  if (!d) throw new ProspectError(404, ERRORS.ACCOUNT_NOT_FOUND[1], "ACCOUNT_NOT_FOUND");
  return {
    ...d,
    demos: d.demos.map((x) => ({ id: x.id, status: x.status, title: x.title, publishedAt: x.published_at, url: x.status === "published" ? demoUrl(origin, x.token) : null })),
  };
}

/** Agencies with their prospecting key, to suggest matches in an import preview. */
export const existingAgencies = () => prospectRpc<ExistingAgency[]>("habita_prospect_agencies");

/** Template version and account data to render it on the server. */
export const renderContext = (account: string, version: string) =>
  prospectRpc<{ body: string; subject: string | null; name: string; decision_maker: string | null; sdr: string | null; demo_token: string | null } | null>(
    "habita_prospect_context",
    { p_account: account, p_version: version },
  );

/** JSON body of a mutation, or a 400. */
export async function body(request: Request): Promise<Record<string, unknown>> {
  const b = await request.json().catch(() => null);
  if (!b || typeof b !== "object" || Array.isArray(b)) throw new HttpError(400, "Solicitud inválida.");
  return b as Record<string, unknown>;
}
export const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) || null : null);
export function iso(v: unknown) {
  if (v == null || v === "") return null;
  if (typeof v !== "string" || Number.isNaN(Date.parse(v))) throw new HttpError(400, "Fecha inválida.");
  return new Date(v).toISOString();
}

/** Like failure(), plus the stable code of a refused prospecting operation. */
export function prospectFailure(e: unknown) {
  if (e instanceof ProspectError) return Response.json({ error: e.message, code: e.code, detail: e.detail }, { status: e.status });
  if (e instanceof HttpError) return Response.json({ error: e.message }, { status: e.status });
  console.error("prospect_error", e instanceof Error ? e.message.slice(0, 120) : "unknown");
  return Response.json({ error: "No pudimos completar la operación. Intentá nuevamente." }, { status: 500 });
}
export const NO_STORE = { "Cache-Control": "private, no-store" };
