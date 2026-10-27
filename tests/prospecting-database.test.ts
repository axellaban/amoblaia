import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Invariants of the prospecting migration, on the real SQL (PGlite).
// Every name and number here is synthetic test data.
let db: PGlite;
let n = 0;
const id = () => `00000000-0000-4000-8000-${String(700000000000 + ++n).padStart(12, "0")}`;
const one = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows[0];
const json = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await one<{ r: T }>(sql, params))!.r;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema storage;
   create table auth.users(id uuid primary key, is_anonymous boolean not null default false);
   create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
   create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
   create table storage.objects(id uuid,name text,bucket_id text);alter table storage.objects enable row level security;
   create function storage.foldername(text) returns text[] language sql immutable as $$select string_to_array($1,'/')$$;
   grant usage on schema public to authenticated;`);
  for (const file of readdirSync("supabase/migrations").sort()) await db.exec(readFileSync(`supabase/migrations/${file}`, "utf8"));
}, 60000);
afterAll(async () => await db?.close());

async function user() {
  const u = id();
  await db.query("insert into auth.users(id) values($1)", [u]);
  await db.query("select amobla_account($1,false)", [u]);
  return u;
}
/** A synthetic agency in the base with one reviewed WhatsApp contact. */
async function prospect(name = `Inmobiliaria Prueba ${n}`) {
  const agency = (await one<{ id: string }>("insert into agencies(name) values($1) returning id", [name]))!.id;
  const account = (await one<{ id: string }>("insert into prospect_accounts(agency_id,sdr,campaign) values($1,'SDR Test','test') returning id", [agency]))!.id;
  const contact = await addContact(account, `+54922300${String(++n).padStart(5, "0")}`);
  return { agency, account, contact };
}
async function addContact(account: string, address: string, channel = "whatsapp", extra: Record<string, unknown> = {}) {
  return (await json<{ id: string }>("select habita_prospect_contact($1,$2,null,$3) as r", [admin, account, { channel, address, verified: true, ...extra }])).id;
}
type Attempt = { id: string; status: string; version: number; ordinal: number | null; replayed?: boolean; template_version_id: string | null; body: string };
const prepare = (account: string, contact: string, o: { key?: string; step?: number; version?: string | null; custom?: boolean; body?: string; actor?: string } = {}) =>
  json<Attempt>("select habita_prospect_prepare($1,$2,$3,$4,$5,'test',$6,$7,null,$8,'SDR Test',true) as r", [
    o.actor ?? admin,
    o.key ?? id(),
    account,
    contact,
    o.step ?? 1,
    o.version ?? null,
    o.custom ?? o.version == null,
    o.body ?? "Hola, texto sintético de prueba.",
  ]);
const open = (attempt: string, version: number, actor = admin) =>
  json<Attempt>("select habita_prospect_open($1,$2,$3,600) as r", [actor, attempt, version]);
const confirm = (attempt: string, actor = admin) =>
  json<Attempt>("select habita_prospect_confirm($1,$2,'channel_observed',null,null,null) as r", [actor, attempt]);
const record = (account: string, type: string, details: Record<string, unknown> = {}, extra: { key?: string; corrects?: string; at?: string } = {}) =>
  json<{ id: string; replayed?: boolean; stopped?: number }>(
    "select habita_prospect_record($1,$2,$3,$4,coalesce($5::timestamptz,now()),'time','whatsapp',null,null,'Captura de prueba',$6,$7) as r",
    [admin, extra.key ?? id(), account, type, extra.at ?? null, details, extra.corrects ?? null],
  );
const count = async (sql: string, params: unknown[] = []) => Number((await one<{ n: number }>(sql, params))!.n);
let admin: string;
let other: string;
beforeAll(async () => {
  admin = await user();
  other = await user();
});

describe("Attempts: prepare, open and confirm", () => {
  it("never counts preparing or opening; confirming twice records one send", async () => {
    const p = await prospect();
    const key = id();
    const a = await prepare(p.account, p.contact, { key });
    expect((await prepare(p.account, p.contact, { key })).id).toBe(a.id);
    const opened = await open(a.id, a.version);
    expect(opened.status).toBe("opened");
    expect(await count("select count(*) as n from prospect_events where account_id=$1 and type='sent'", [p.account])).toBe(0);
    const sent = await confirm(a.id);
    expect(sent).toMatchObject({ status: "sent", ordinal: 1 });
    expect((await confirm(a.id)).replayed).toBe(true);
    expect(await count("select count(*) as n from prospect_events where account_id=$1 and type='sent'", [p.account])).toBe(1);
    expect((await one<{ stage: string }>("select stage from prospect_accounts where id=$1", [p.account]))!.stage).toBe("sent");
  });

  it("allows one live attempt per account and refuses a second operator", async () => {
    const p = await prospect();
    const a = await prepare(p.account, p.contact);
    await expect(prepare(p.account, p.contact)).rejects.toThrow(/ATTEMPT_OPEN/);
    const o = await open(a.id, a.version);
    await expect(open(a.id, o.version, other)).rejects.toThrow(/LOCKED/);
    await expect(confirm(a.id, other)).rejects.toThrow(/LOCKED/);
    await expect(open(a.id, 999)).resolves.toMatchObject({ status: "opened" }); // same operator, same lease
    expect((await confirm(a.id)).status).toBe("sent");
  });

  it("rejects a stale version when opening", async () => {
    const p = await prospect();
    const a = await prepare(p.account, p.contact);
    await expect(open(a.id, a.version + 1)).rejects.toThrow(/STALE/);
  });

  it("turns an expired lease into an uncertain result, never into a new send", async () => {
    const p = await prospect();
    const a = await prepare(p.account, p.contact);
    const o = await open(a.id, a.version);
    await db.query("update outreach_attempts set lock_expires_at=now()-interval '1 minute' where id=$1", [a.id]);
    const u = await open(a.id, o.version, other);
    expect(u.status).toBe("uncertain");
    // Blocks any new attempt until reconciled.
    await expect(prepare(p.account, p.contact)).rejects.toThrow(/ATTEMPT_OPEN/);
    expect(await count("select count(*) as n from outreach_attempts where account_id=$1 and status='sent'", [p.account])).toBe(0);
    // Reconciled by hand: the operator checked the channel and it was sent.
    const s = await json<Attempt>("select habita_prospect_confirm($1,$2,'manual',null,null,'Revisado en WhatsApp') as r", [other, a.id]);
    expect(s.status).toBe("sent");
    expect((await one<{ details: { reconciled: boolean } }>("select details from prospect_events where attempt_id=$1 and type='sent'", [a.id]))!.details.reconciled).toBe(true);
  });

  it("records failures, invalid numbers and bounces apart from sends", async () => {
    const p = await prospect();
    const a = await prepare(p.account, p.contact);
    await open(a.id, a.version);
    await json("select habita_prospect_resolve($1,$2,'invalid_endpoint','El número no tiene WhatsApp') as r", [admin, a.id]);
    expect((await one<{ invalid_at: string | null }>("select invalid_at from prospect_contacts where id=$1", [p.contact]))!.invalid_at).not.toBeNull();
    await expect(prepare(p.account, p.contact)).rejects.toThrow(/CONTACT_INVALID/);
    // The account is still workable with another contact.
    const mail = await addContact(p.account, "ventas@example.test", "email");
    const b = await json<Attempt>("select habita_prospect_prepare($1,$2,$3,$4,1,'test',null,true,'Asunto','Texto','SDR Test',true) as r", [admin, id(), p.account, mail]);
    await open(b.id, b.version);
    await confirm(b.id);
    await json("select habita_prospect_resolve($1,$2,'bounced','Rebote del servidor') as r", [admin, b.id]);
    expect(await count("select count(*) as n from outreach_attempts where account_id=$1 and status='sent'", [p.account])).toBe(0);
  });

  it("requires a reviewed, known recipient", async () => {
    const p = await prospect();
    const unsure = await json<{ id: string }>("select habita_prospect_contact($1,$2,null,$3) as r", [
      admin,
      p.account,
      { channel: "whatsapp", address: "+5492235550000", needs_review: true, review_reason: "Se asumió celular" },
    ]);
    await expect(prepare(p.account, unsure.id)).rejects.toThrow(/CONTACT_NEEDS_REVIEW/);
    await expect(
      json("select habita_prospect_prepare($1,$2,$3,$4,1,'test',null,true,null,'Texto','SDR',false) as r", [admin, id(), p.account, p.contact]),
    ).rejects.toThrow(/RECIPIENT_NOT_REVIEWED/);
  });
});

describe("Suppressions and sequence stop", () => {
  it("an account opt-out cancels prepared attempts and blocks every contact until lifted", async () => {
    const p = await prospect();
    const a = await prepare(p.account, p.contact);
    const s = await json<{ id: string; cancelled: number }>("select habita_prospect_suppress($1,$2,'account',null,null,'Pidió no recibir mensajes') as r", [admin, p.account]);
    expect(s.cancelled).toBe(1);
    expect((await one<{ status: string }>("select status from outreach_attempts where id=$1", [a.id]))!.status).toBe("cancelled");
    const alt = await addContact(p.account, "otra@example.test", "email");
    await expect(
      json("select habita_prospect_prepare($1,$2,$3,$4,1,'test',null,true,'A','B','SDR',true) as r", [admin, id(), p.account, alt]),
    ).rejects.toThrow(/SUPPRESSED:account/);
    await json("select habita_prospect_lift($1,$2,'Volvió a pedir información') as r", [admin, s.id]);
    await expect(prepare(p.account, p.contact)).resolves.toMatchObject({ status: "prepared" });
  });

  it("an opt-out after opening the chat still lets the real send be recorded, but opening again is refused", async () => {
    const p = await prospect();
    const a = await prepare(p.account, p.contact);
    await open(a.id, a.version);
    await json("select habita_prospect_suppress($1,$2,'channel','whatsapp',null,'Baja por WhatsApp') as r", [admin, p.account]);
    expect((await confirm(a.id)).status).toBe("sent");
    await expect(prepare(p.account, p.contact, { step: 2 })).rejects.toThrow(/SUPPRESSED:channel/);
  });

  it("a reply stops pending follow-ups; only conversation messages follow", async () => {
    const p = await prospect();
    const a = await prepare(p.account, p.contact);
    await open(a.id, a.version);
    await confirm(a.id);
    const f = await prepare(p.account, p.contact, { step: 2 });
    const r = await record(p.account, "reply");
    expect(r.stopped).toBe(1);
    expect((await one<{ status: string; status_reason: string }>("select status,status_reason from outreach_attempts where id=$1", [f.id]))).toEqual({
      status: "cancelled",
      status_reason: "sequence_stopped_by_reply",
    });
    await expect(prepare(p.account, p.contact, { step: 2 })).rejects.toThrow(/SEQUENCE_STOPPED/);
    await expect(prepare(p.account, p.contact, { step: 0 })).resolves.toMatchObject({ status: "prepared" });
  });

  it("losing the account keeps the reply milestone; recording twice with the same key is one event", async () => {
    const p = await prospect();
    const key = id();
    await record(p.account, "reply", {}, { key });
    expect((await record(p.account, "reply", {}, { key })).replayed).toBe(true);
    await record(p.account, "lost", { reason: "Eligió otro proveedor" });
    expect((await one<{ stage: string }>("select stage from prospect_accounts where id=$1", [p.account]))!.stage).toBe("lost");
    expect(await count("select count(*) as n from prospect_events where account_id=$1 and type='reply'", [p.account])).toBe(1);
    await record(p.account, "reopened");
    expect((await one<{ stage: string }>("select stage from prospect_accounts where id=$1", [p.account]))!.stage).toBe("conversation");
  });

  it("history is append-only; a correction is a new event", async () => {
    const p = await prospect();
    const r = await record(p.account, "reply");
    await expect(db.query("update prospect_events set type='note' where id=$1", [r.id])).rejects.toThrow(/APPEND_ONLY/);
    await expect(db.query("delete from prospect_events where id=$1", [r.id])).rejects.toThrow(/APPEND_ONLY/);
    await record(p.account, "correction", { reason: "Era una respuesta automática" }, { corrects: r.id });
    expect(await json<boolean>("select habita_prospect_replied($1) as r", [p.account])).toBe(false);
    await expect(record(p.account, "correction", { reason: "otra vez" }, { corrects: r.id })).rejects.toThrow(/ALREADY_CORRECTED/);
  });

  it("interest requires evidence", async () => {
    const p = await prospect();
    await expect(
      json("select habita_prospect_record($1,$2,$3,'interest',now(),'time',null,null,null,null,'{}',null) as r", [admin, id(), p.account]),
    ).rejects.toThrow(/EVIDENCE_REQUIRED/);
  });
});

describe("Templates", () => {
  it("editing creates a new version; sent texts and custom messages are untouched", async () => {
    const t = await json<{ id: string; template_id: string; version: number }>(
      "select habita_prospect_template($1,null,'Corto','Prueba',1,'whatsapp',null,'Hola v1') as r",
      [admin],
    );
    expect(t.version).toBe(1);
    const p = await prospect();
    const a = await prepare(p.account, p.contact, { version: t.id, custom: false, body: "Hola v1" });
    expect(a.template_version_id).toBe(t.id);
    const v2 = await json<{ id: string; version: number }>("select habita_prospect_template($1,$2,null,null,null,null,null,'Hola v2') as r", [admin, t.template_id]);
    expect(v2.version).toBe(2);
    await expect(db.query("update outreach_template_versions set body='x' where id=$1", [t.id])).rejects.toThrow(/APPEND_ONLY/);
    expect((await one<{ body: string }>("select body from outreach_attempts where id=$1", [a.id]))!.body).toBe("Hola v1");
    // A custom text keeps its base for reference but is never a variant.
    const q = await prospect();
    const c = await prepare(q.account, q.contact, { version: v2.id, custom: true, body: "Texto editado" });
    expect(c.template_version_id).toBeNull();
    // A template of another channel or step is refused.
    await json("select habita_prospect_resolve($1,$2,'cancelled',null) as r", [admin, c.id]);
    await expect(prepare(q.account, q.contact, { version: v2.id, custom: false, step: 2 })).rejects.toThrow(/TEMPLATE_MISMATCH/);
  });
});

describe("Account edits", () => {
  it("uses optimistic concurrency and keeps a score history", async () => {
    const p = await prospect();
    const v = (await one<{ version: number }>("select version from prospect_accounts where id=$1", [p.account]))!.version;
    const b = await json<{ version: number }>("select habita_prospect_update($1,$2,$3,$4) as r", [admin, p.account, v, { next_action: "Llamar", score: 80 }]);
    await expect(json("select habita_prospect_update($1,$2,$3,$4) as r", [admin, p.account, v, { next_action: "Otra" }])).rejects.toThrow(/STALE/);
    expect(b.version).toBe(v + 1);
    expect(await count("select count(*) as n from prospect_events where account_id=$1 and type='score_changed'", [p.account])).toBe(1);
    await expect(json("select habita_prospect_update($1,$2,$3,$4) as r", [admin, p.account, b.version, { stage: "customer" }])).rejects.toThrow(/INVALID_STAGE/);
  });
});

describe("Import", () => {
  const rows = (notes: string, sdr = "SDR Hoja") => [
    {
      row_number: 2,
      source_key: "nombre:fixture-norte",
      name: "Fixture Norte Propiedades",
      sdr,
      score: 88,
      score_components: { contacto: 30, decisor: 25, stock: 25, actividad: 8 },
      notes,
      legacy_status: "sent",
      sent_date: "2026-10-10",
      contacts: [{ channel: "whatsapp", address: "+5492230000001", address_original: "2230000001", needs_review: true }],
      raw: { Inmobiliaria: "Fixture Norte Propiedades" },
    },
    {
      row_number: 3,
      source_key: "nombre:fixture-sur",
      name: "Fixture Sur",
      legacy_status: "invalid",
      contacts: [{ channel: "whatsapp", address: "+5492230000002", invalid: true, invalid_reason: "Número incorrecto (planilla)" }],
      raw: {},
    },
  ];
  const apply = (rs: unknown[], overwrite = false) =>
    json<Record<string, number | boolean>>("select habita_prospect_import($1,$2,'planilla-test','f.csv',null,'{}',$3,$4) as r", [admin, id(), JSON.stringify(rs), overwrite]);

  it("re-importing never duplicates accounts, contacts or legacy sends and keeps the team's SDR", async () => {
    const first = await apply(rows("corto v2"));
    expect(first).toMatchObject({ created: 2, legacy_sends: 1 });
    const acc = (await one<{ id: string }>("select id from prospect_accounts where source_key='nombre:fixture-norte'"))!.id;
    const v = (await one<{ version: number }>("select version from prospect_accounts where id=$1", [acc]))!.version;
    await json("select habita_prospect_update($1,$2,$3,$4) as r", [admin, acc, v, { sdr: "SDR Equipo" }]);
    const again = await apply(rows("corto v2"));
    expect(again).toMatchObject({ created: 0, unchanged: 2, legacy_sends: 0 });
    const changed = await apply(rows("corto v2, luego v3", "Otro SDR"));
    expect(changed).toMatchObject({ updated: 1 });
    const a = (await one<{ sdr: string; source_notes: string }>("select sdr,source_notes from prospect_accounts where id=$1", [acc]))!;
    expect(a).toEqual({ sdr: "SDR Equipo", source_notes: "corto v2, luego v3" });
    expect(await count("select count(*) as n from prospect_accounts where source='planilla-test'")).toBe(2);
    expect(await count("select count(*) as n from prospect_contacts where account_id=$1", [acc])).toBe(1);
    expect(await count("select count(*) as n from outreach_attempts where account_id=$1", [acc])).toBe(1);
    const legacy = (await one<{ channel: string; sent_precision: string; variant_label: string | null; verification_method: string }>(
      "select channel,sent_precision,variant_label,verification_method from outreach_attempts where account_id=$1",
      [acc],
    ))!;
    expect(legacy).toEqual({ channel: "unknown", sent_precision: "day", variant_label: null, verification_method: "imported" });
    // "Número incorrecto" invalidates the endpoint, not the account.
    const sur = (await one<{ id: string; stage: string }>("select id,stage from prospect_accounts where source_key='nombre:fixture-sur'"))!;
    expect(sur.stage).toBe("pending");
    expect(await count("select count(*) as n from prospect_contacts where account_id=$1 and invalid_at is not null", [sur.id])).toBe(1);
  });

  it("the same import id applied twice returns its report", async () => {
    const key = id();
    const rs = [{ row_number: 2, source_key: "nombre:fixture-once", name: "Fixture Once", raw: {} }];
    await json("select habita_prospect_import($1,$2,'planilla-once',null,null,'{}',$3,false) as r", [admin, key, JSON.stringify(rs)]);
    const second = await json<{ replayed: boolean }>("select habita_prospect_import($1,$2,'planilla-once',null,null,'{}',$3,false) as r", [admin, key, JSON.stringify(rs)]);
    expect(second.replayed).toBe(true);
    expect(await count("select count(*) as n from prospect_accounts where source='planilla-once'")).toBe(1);
  });
});

describe("Activation and purchase", () => {
  it("counts only server evidence of members of the agency, after they joined", async () => {
    const p = await prospect();
    const owner = await user();
    const buyer = await user();
    // A buyer's payment before any link: never the agency's.
    const order = (await one<{ id: string }>("insert into orders(user_id,sku,snapshot) select $1,sku,'{}' from products limit 1 returning id", [buyer]))!.id;
    await db.query("insert into payments(id,order_id,user_id,status,amount_cents,paid_at) values($1,$2,$3,'approved',100,now())", [`pay-${id()}`, order, buyer]);
    await db.query("select habita_prospect_sync_conversions()");
    expect(await count("select count(*) as n from prospect_events where account_id=$1 and type='purchased'", [p.account])).toBe(0);
    await db.query("update agencies set owner_id=$1 where id=$2", [owner, p.agency]);
    await db.query("insert into agency_members(agency_id,user_id,role) values($1,$2,'owner')", [p.agency, owner]);
    const order2 = (await one<{ id: string }>("insert into orders(user_id,sku,snapshot) select $1,sku,'{}' from products limit 1 returning id", [owner]))!.id;
    const pay = `pay-${id()}`;
    await db.query("insert into payments(id,order_id,user_id,status,amount_cents,paid_at) values($1,$2,$3,'approved',100,now()+interval '1 second')", [pay, order2, owner]);
    await db.query("select habita_prospect_sync_conversions()");
    await db.query("select habita_prospect_sync_conversions()");
    expect(await count("select count(*) as n from prospect_events where account_id=$1 and type='purchased'", [p.account])).toBe(1);
    expect((await one<{ stage: string }>("select stage from prospect_accounts where id=$1", [p.account]))!.stage).toBe("customer");
    // A refund keeps the purchase and adds its own event.
    await db.query("update payments set status='refunded' where id=$1", [pay]);
    await db.query("select habita_prospect_sync_conversions()");
    expect(await count("select count(*) as n from prospect_events where account_id=$1 and type in ('purchased','refunded')", [p.account])).toBe(2);
  });
});

describe("Reads", () => {
  it("returns the dataset, an account sheet and import matches as JSON", async () => {
    const p = await prospect("FICTICIA Lectura");
    const ds = await json<{ accounts: { id: string; contacts: unknown[] }[]; settings: { message_window_days: number } }>("select habita_prospect_dataset() as r");
    expect(ds.settings.message_window_days).toBe(7);
    expect(ds.accounts.find((a) => a.id === p.account)!.contacts).toHaveLength(1);
    const d = await json<{ account: { id: string }; agency: { name: string; linked: boolean }; contacts: unknown[] }>("select habita_prospect_account($1) as r", [p.account]);
    expect(d).toMatchObject({ account: { id: p.account }, agency: { name: "FICTICIA Lectura", linked: false } });
    expect(await json("select habita_prospect_account($1) as r", [id()])).toBeNull();
    const ags = await json<{ id: string; account_id: string | null }[]>("select habita_prospect_agencies() as r");
    expect(ags.find((a) => a.id === p.agency)!.account_id).toBe(p.account);
    const again = await json<{ id: string; replayed: boolean }>("select habita_prospect_add($1,$2,null,null,null,null,null) as r", [admin, p.agency]);
    expect(again).toMatchObject({ id: p.account, replayed: true });
  });
});

describe("Privacy", () => {
  it("browsers (anon, authenticated) cannot read prospecting tables or run its functions", async () => {
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`set role ${role}`);
      try {
        for (const t of ["prospect_accounts", "prospect_contacts", "prospect_events", "outreach_attempts", "prospect_suppressions"])
          await expect(db.query(`select * from ${t} limit 1`)).rejects.toThrow(/permission denied/);
        await expect(db.query("select habita_prospect_dataset()")).rejects.toThrow(/permission denied/);
      } finally {
        await db.exec("reset role");
      }
    }
  });
});
