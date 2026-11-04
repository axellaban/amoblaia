#!/usr/bin/env node
// QA diario: inicia sesión en Habita con la cuenta de QA y guarda el estado
// del navegador (cookies de Supabase) para usarlo con Playwright.
//
// En producción /acceso solo muestra Google, así que el ingreso se hace con
// la contraseña directo contra Supabase Auth y se escriben las mismas
// cookies que pone @supabase/ssr en la app.
//
// Credenciales: variables de entorno HABITA_QA_EMAIL y HABITA_QA_PASSWORD
// (secretos del entorno de la nube; nunca en el repo).
//
// Uso:
//   node scripts/qa-login.mjs [salida.json] [--check]
//   --check abre /admin con la sesión y confirma que entra.
//
// Después, en Playwright:
//   browser.newContext({ storageState: "salida.json" })
import console from "node:console";
import process from "node:process";
import { URL } from "node:url";
import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServerClient } from "@supabase/ssr";

const SITE = process.env.HABITA_QA_SITE || "https://www.habitaia.app";
// Valores públicos por diseño (NEXT_PUBLIC_*), los mismos que usa el navegador.
const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  "https://cmpfwuycxdleunuumlkm.supabase.co";
const SUPABASE_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
  "sb_publishable_3QAmaSHGuF5ubdu57jCobA_tQLXjMYO";

const args = process.argv.slice(2);
const check = args.includes("--check");
const out = args.find((a) => !a.startsWith("--")) || join(tmpdir(), "habita-qa-session.json");

const email = process.env.HABITA_QA_EMAIL;
const password = process.env.HABITA_QA_PASSWORD;
if (!email || !password) {
  console.error("Faltan HABITA_QA_EMAIL / HABITA_QA_PASSWORD en el entorno.");
  process.exit(1);
}

const jar = new Map();
const supabase = createServerClient(SUPABASE_URL, SUPABASE_KEY, {
  cookies: {
    getAll: () => [...jar.entries()].map(([name, value]) => ({ name, value })),
    setAll: (list) => {
      for (const { name, value } of list) {
        if (value) jar.set(name, value);
        else jar.delete(name);
      }
    },
  },
});

const { data, error } = await supabase.auth.signInWithPassword({ email, password });
if (error || !data.session) {
  console.error("No se pudo ingresar:", error?.message || "sin sesión");
  process.exit(1);
}

const host = new URL(SITE).hostname;
const expires = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7;
const state = {
  cookies: [...jar.entries()].map(([name, value]) => ({
    name,
    value,
    domain: host,
    path: "/",
    expires,
    httpOnly: false,
    secure: true,
    sameSite: "Lax",
  })),
  origins: [],
};
writeFileSync(out, JSON.stringify(state), { mode: 0o600 });
console.log(`Sesión guardada en ${out} (${data.user.email}).`);

if (check) {
  const require = createRequire(import.meta.url);
  const { chromium } = require("playwright");
  const browser = await chromium.launch();
  const context = await browser.newContext({ storageState: out });
  const page = await context.newPage();
  const response = await page.goto(`${SITE}/admin`, { waitUntil: "domcontentloaded" });
  const url = page.url();
  await browser.close();
  const ok = response?.ok() && !url.includes("/acceso");
  console.log(ok ? `OK: /admin abre (${response.status()}).` : `FALLA: ${response?.status()} → ${url}`);
  process.exit(ok ? 0 : 1);
}
