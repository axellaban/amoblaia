import "server-only";
import { HttpError } from "@/lib/commerce/http";
import { isUuid } from "@/lib/demos/shared";
import { adminClient } from "@/lib/supabase/server";
import { createDeviceLink, invalidateInternalCache, recomputeAfterInternalChange, setDeviceStatus } from "./server";
import { normalizeEmail, type DeviceStatus, type InternalRole } from "./shared";

/**
 * /admin/internos: the registry of the team's people, their accounts and
 * devices. Only the team reads it (requireAdmin); every change is audited
 * and recalculates what it affects. The e-mails never leave this API.
 */

const ROLES: InternalRole[] = ["admin", "collaborator", "test"];
const STATUSES: DeviceStatus[] = ["internal", "unknown", "external", "revoked"];

export type InternalPerson = {
  id: string;
  label: string;
  role: InternalRole;
  active: boolean;
  note: string | null;
  identities: { id: string; kind: "email" | "user_id"; value: string }[];
};
export type InternalDevice = {
  id: string;
  person_id: string | null;
  status: DeviceStatus;
  source: string;
  label: string | null;
  evidence: string | null;
  visitor_ids: string[];
  ph_device_ids: string[];
  first_seen_at: string;
  last_seen_at: string;
  status_at: string;
  status_reason: string | null;
};

function check<T>(r: { data: T | null; error: unknown }, code: string) {
  if (r.error) throw new Error(code);
  return r.data as T;
}

export async function internalOverview() {
  const db = adminClient();
  const [people, identities, devices, fingerprints] = await Promise.all([
    db.from("internal_people").select("id,label,role,active,note").order("created_at"),
    db.from("internal_identities").select("id,person_id,kind,value").order("created_at"),
    db
      .from("internal_devices")
      .select("id,person_id,status,source,label,evidence,visitor_ids,ph_device_ids,first_seen_at,last_seen_at,status_at,status_reason")
      .order("last_seen_at", { ascending: false })
      .limit(500),
    db.from("internal_fingerprints").select("hash", { count: "exact", head: true }).gt("expires_at", new Date().toISOString()),
  ]);
  const ids = check(identities, "INTERNAL_READ_FAILED") as (InternalPerson["identities"][number] & { person_id: string })[];
  return {
    people: (check(people, "INTERNAL_READ_FAILED") as Omit<InternalPerson, "identities">[]).map((p) => ({
      ...p,
      identities: ids.filter((i) => i.person_id === p.id).map(({ id, kind, value }) => ({ id, kind, value })),
    })),
    devices: check(devices, "INTERNAL_READ_FAILED") as InternalDevice[],
    fingerprints: fingerprints.count ?? 0,
  };
}

async function audit(actor: string, action: string, details: Record<string, unknown>) {
  await adminClient().from("admin_audit").insert({ actor_id: actor, action, subject_id: null, details });
}

const text = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

/** One change from the page: { action, ... }. Returns what the page needs to show. */
export async function internalAction(body: Record<string, unknown>, actor: string, origin: string) {
  const db = adminClient();
  const action = body.action;
  const id = typeof body.id === "string" && isUuid(body.id) ? body.id : null;
  let recompute: string[] | "all" | null = null;
  let result: Record<string, unknown> = { ok: true };

  if (action === "person_create") {
    const label = text(body.label, 80);
    const role = ROLES.find((r) => r === body.role) ?? "collaborator";
    const emails = (Array.isArray(body.emails) ? body.emails : [body.email]).map(normalizeEmail).filter((e): e is string => Boolean(e));
    if (!label) throw new HttpError(400, "Poné un nombre.");
    if (!emails.length) throw new HttpError(400, "Agregá al menos un email válido.");
    const person = check(await db.from("internal_people").insert({ label, role, created_by: actor }).select("id").single(), "INTERNAL_WRITE_FAILED") as { id: string };
    const { error } = await db.from("internal_identities").insert(emails.map((value) => ({ person_id: person.id, kind: "email", value, created_by: actor })));
    if (error) {
      await db.from("internal_people").delete().eq("id", person.id);
      throw new HttpError(409, "Alguno de esos emails ya está registrado.");
    }
    await audit(actor, "internal_person_create", { person: person.id, role, emails: emails.length });
    recompute = "all";
    result = { ok: true, id: person.id };
  } else if (action === "person_update" && id) {
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    const label = text(body.label, 80);
    if (label) patch.label = label;
    if (ROLES.includes(body.role as InternalRole)) patch.role = body.role;
    if (typeof body.active === "boolean") patch.active = body.active;
    if (typeof body.note === "string") patch.note = text(body.note, 200);
    check(await db.from("internal_people").update(patch).eq("id", id), "INTERNAL_WRITE_FAILED");
    await audit(actor, "internal_person_update", { person: id, ...patch });
    if (typeof body.active === "boolean") recompute = "all";
  } else if (action === "identity_add" && id) {
    const value = normalizeEmail(body.email);
    if (!value) throw new HttpError(400, "Ese email no es válido.");
    const { error } = await db.from("internal_identities").insert({ person_id: id, kind: "email", value, created_by: actor });
    if (error) throw new HttpError(409, "Ese email ya está registrado.");
    await audit(actor, "internal_identity_add", { person: id });
    recompute = "all";
  } else if (action === "identity_remove" && id) {
    check(await db.from("internal_identities").delete().eq("id", id), "INTERNAL_WRITE_FAILED");
    await audit(actor, "internal_identity_remove", { identity: id });
    recompute = "all";
  } else if (action === "device_status" && id) {
    const status = STATUSES.find((s) => s === body.status);
    if (!status) throw new HttpError(400, "Estado inválido.");
    const before = check(await db.from("internal_devices").select("visitor_ids,ph_device_ids").eq("id", id).maybeSingle(), "INTERNAL_READ_FAILED") as {
      visitor_ids: string[];
      ph_device_ids: string[];
    } | null;
    if (!before) throw new HttpError(404, "No encontramos ese dispositivo.");
    await setDeviceStatus(id, status, "panel", actor);
    await audit(actor, "internal_device_status", { device: id, status });
    recompute = [...before.visitor_ids, ...before.ph_device_ids.map((p) => `ph:${p}`)];
  } else if (action === "devices_confirm_unknown") {
    // «Marcar todos los desconocidos como internos»: the team decided they are its own.
    const rows = check(await db.from("internal_devices").select("id").eq("status", "unknown").limit(1000), "INTERNAL_READ_FAILED") as { id: string }[];
    for (const r of rows) await setDeviceStatus(r.id, "internal", "panel_lote", actor);
    await audit(actor, "internal_devices_confirm_unknown", { devices: rows.length });
    recompute = "all";
    result = { ok: true, devices: rows.length };
  } else if (action === "link_create" && id) {
    const link = await createDeviceLink(id, actor, origin);
    await audit(actor, "internal_link_create", { person: id });
    result = { ok: true, ...link };
  } else if (action === "recompute") {
    recompute = "all";
  } else throw new HttpError(400, "Acción inválida.");

  invalidateInternalCache();
  if (recompute) result.recalculated = await recomputeAfterInternalChange(recompute);
  return result;
}
