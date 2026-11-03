# Habita V2 — Fase 4 (versión simple acordada): crear cuenta sin fricción y reclamo visible

**Decisión del 01/11/2026:** crear la cuenta sigue siendo instantáneo (Google o email y contraseña) para no frenar la activación. En lugar de bloquear, se **registra y se muestra al equipo** quién reclamó cada inmobiliaria. La verificación por código de email queda para cuando haya dominio propio y SMTP (ver §4).

## 1. Qué cambió

| Pieza | Archivo |
| --- | --- |
| «Continuar con Google» como opción principal en «Guardar mi panel»; email y contraseña debajo; en mobile el acceso va antes que la ficha | [`src/components/agency-invitation.tsx`](../../src/components/agency-invitation.tsx) |
| Al volver de Google, el reclamo sigue solo (`continuar=google`), sin otro clic | [`src/app/panel/empezar/page.tsx`](../../src/app/panel/empezar/page.tsx), `AgencyOnboarding` |
| Registro de quién reclamó: email, método (google / email / cuenta existente) y revisión (`ok` dominio o contacto de la inmobiliaria · `personal` gmail/hotmail… · `mismatch` otro dominio) + fila en `admin_audit` | [`src/lib/agency/claim-review.ts`](../../src/lib/agency/claim-review.ts), `recordClaim` en [`invitation.ts`](../../src/lib/agency/invitation.ts), [`/api/panel/reclamar`](../../src/app/api/panel/reclamar/route.ts) |
| Administración: aviso «Quién reclamó la cuenta» con «Marcar como verificado»; listado «Cuentas reclamadas para revisar» | [`admin-claim-review.tsx`](../../src/components/admin-claim-review.tsx), [`/api/admin/inmobiliarias/[id]/reclamo`](../../src/app/api/admin/inmobiliarias/[id]/reclamo/route.ts), páginas de `/admin/inmobiliarias` |
| Embudo PostHog: `panel_claim_started`, `panel_claim_completed` (`method`), `second_property_import_started`, `second_property_created` | componentes de invitación, onboarding e importador |
| Migración (aditiva) | [`202611180001_claim_review.sql`](https://github.com/axellaban/amoblaia/blob/claude/friendly-shannon-54k8z1/supabase/migrations/202611180001_claim_review.sql) — **aplicada** el 01/11/2026 en `cmpfwuycxdleunuumlkm`; columnas sin privilegios para `anon`/`authenticated` |

Registrar el reclamo nunca lo bloquea: si falla, solo queda en el log (`claim_record_failed`). La lectura en administración tolera una base sin las columnas.

## 2. Embudo medible ahora

`demo_vista` → `demo_value_action` (download/share/generation/edit) → `panel_claim_started` → `panel_claim_completed` → `second_property_import_started` (desde la demo antes del registro, o desde el panel) → `second_property_created`. «Guardó panel» no es adopción: la señal es `second_property_created`.

## 3. Evidencia

[`docs/ux/habita-v2/evidencia/fase-4/`](../ux/habita-v2/evidencia/fase-4/): `claim-mobile-viewport.jpg` (Google en el primer viewport), `claim-desktop.jpg`. Tests: [`tests/claim-review.test.ts`](../../tests/claim-review.test.ts) (reglas, registro, migración idempotente y restricciones). `npm test` 838/838 · lint · typecheck · build OK.

## 4. Deuda consciente (no implementada)

- **El link reenviado todavía permite reclamar**: se detecta y queda marcado en administración, no se impide. Revertir un dueño se hace desde soporte (sin botón todavía).
- `acceptWithNewAccount` sigue creando la cuenta con el email dado por verificado. Se corrige con la verificación por código cuando haya **dominio propio + SMTP** (Resend u otro) configurado en Supabase; el flujo de Google no necesita cambios.
- Pedido de un colaborador para unirse a un panel ya reclamado: usa el flujo existente de `/panel/unirme` con aprobación; sin cambios en esta fase.
