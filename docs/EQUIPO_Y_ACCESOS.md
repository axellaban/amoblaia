# Equipo y accesos: onboarding sin reclamo, equipo y administración principal (5 de noviembre de 2026)

Rama `claude/equipo-y-accesos`. **No se aplicó ninguna migración en producción.**

Principio: primero usar, después colaborar, finalmente administrar.

## 1. Modelo

| Concepto | Dónde vive | Notas |
| --- | --- | --- |
| Inmobiliaria (espacio) | `agencies` | Identificador estable (`id`). Nunca se crea otra por coincidencia de nombre. |
| Cuenta de facturación | `agencies.owner_id` (rol `owner`) | Sus créditos pagan todo. Las fotos, las generaciones y las suscripciones de Mercado Pago están a su nombre. **No cambia con una transferencia.** |
| Administrador principal | `agencies.principal_id` (nuevo) | Al principio es la cuenta de facturación. Si su fila de integrante desaparece, vuelve a ser la cuenta de facturación (`habita_principal`). Nunca queda vacío. |
| Membresía | `agency_members` | Una inmobiliaria por cuenta (igual que antes). |
| Invitación | `agency_invites` | Token de un solo uso (hash), email obligatorio, 14 días de validez, revocable. |
| Solicitud de acceso | `agency_access_requests` (nueva) | Una pendiente por persona e inmobiliaria. Como máximo 5 abiertas por cuenta. |
| Solicitud de transferencia | `agency_admin_transfers` (nueva) | Una pendiente por solicitante. Al aprobar una, las demás quedan `superseded`. |
| Auditoría | `admin_audit` | Solicitudes, aprobaciones, rechazos y transferencias. |

Roles visibles:

| Visible | Interno | Puede |
| --- | --- | --- |
| Administrador | `owner`, `admin` | Todo lo de un miembro, más invitar, cambiar permisos, quitar accesos y aprobar solicitudes. |
| Miembro | `editor` | Ver, crear y editar propiedades, crear demos, generar imágenes y videos con los créditos compartidos, ver el saldo. |
| Solo vista | `viewer` | Solo para los accesos creados antes. No se ofrece en invitaciones nuevas. |

Ningún rol existente cambió. Los permisos se validan en el servidor (`requireAgency`, `assertCan`) y en las funciones de la base de datos.

**Compras:** solo la cuenta de facturación puede comprar. Ahora `/api/checkout` rechaza (403) a cualquier otro integrante, porque esos créditos irían a una cuenta personal que la inmobiliaria no usa.

## 2. Journeys

**A. Primer usuario (desde la demo privada).** El enlace de presentación del equipo trae una invitación de un solo uso: esa es la condición verificable. Una demo pública sin código nunca da permisos.
- Sin sesión: `/panel/empezar?codigo=…` (Google o email). Después de autenticarse, el espacio se activa solo y abre la propiedad de la demo con `?bienvenida=1`.
- Con sesión: `/panel/visita?codigo=…` agrega `?activar=1` y el panel lo activa al llegar. Sin `activar`, lo activa el primer cambio o el botón «Empezar a trabajar» de la franja.
- Ya no aparece «¿Usás esta cuenta para…?». La bienvenida del editor muestra el nombre de la inmobiliaria y el saldo real (`/api/panel/creditos`).

**B. Segundo integrante.** «Equipo y accesos» → «Invitar integrante» → email + Miembro (predeterminado) o Administrador → enlace para enviar por WhatsApp o copiarlo (**no hay proveedor de email en el repo**). El invitado entra con ese mismo email (Google o contraseña) y se suma a la inmobiliaria que ya existe: no se crea otra y no recibe créditos nuevos.

**C. Sin invitación.** Una demo pública, un código ya usado o el enlace fijo `/i/…` de una inmobiliaria que ya tiene equipo llevan a `/panel/solicitar-acceso`: «X ya tiene un espacio en Habita», con Solicitar acceso y Volver a la demostración. Los administradores ven la solicitud con un contador en la navegación y la aprueban (entra como Miembro) o la rechazan. Si la inmobiliaria todavía no tiene espacio, la solicitud le llega al equipo de habita (`GET /api/admin/inmobiliarias/<id>/administracion`).
- **Cambio de comportamiento:** el enlace fijo `/i/…` ya no abre como invitado el panel privado de una inmobiliaria que tiene equipo. Pide iniciar sesión (un integrante entra directo) o solicitar acceso.

**D. El titular pide la administración.** «Equipo y accesos» → «Administración de la inmobiliaria» → «Solicitar administración». El administrador principal ve «Solicitud de administración», con las consecuencias explicadas, y aprueba (pide confirmación) o rechaza. También puede transferirla directo desde el menú de un integrante. Si el principal no responde, el equipo de habita verifica la titularidad y resuelve con `POST /api/admin/inmobiliarias/<id>/administracion { transfer, approve, reason }`; queda auditado. No hay transferencia automática por nombre o email.

## 3. Migración `202611260001_workspace_access.sql`

Es aditiva e idempotente:
- agrega `principal_id` y lo completa con `owner_id`;
- agrega el trigger `habita_default_principal`;
- crea las dos tablas con RLS sin políticas (solo `service_role`);
- crea las funciones `habita_principal`, `habita_request_access`, `habita_resolve_access_request`, `habita_request_admin_transfer`, `habita_set_principal`, `habita_resolve_admin_transfer` y `habita_transfer_principal`.

No borra ni reasigna datos.

**Sin la migración:** el panel sigue funcionando y la cuenta dueña sigue siendo la principal. «Equipo y accesos» muestra la lista. Solicitar acceso y transferir responden 503 y piden aplicarla.

**Reversión** (solo si hiciera falta, antes de que haya transferencias reales):

```sql
begin;
drop function if exists public.habita_transfer_principal(uuid,uuid,uuid);
drop function if exists public.habita_resolve_admin_transfer(uuid,uuid,uuid,boolean,boolean);
drop function if exists public.habita_set_principal(uuid,uuid,uuid,uuid,text);
drop function if exists public.habita_request_admin_transfer(uuid,uuid);
drop function if exists public.habita_resolve_access_request(uuid,uuid,uuid,boolean);
drop function if exists public.habita_request_access(uuid,uuid,text,text,uuid);
drop function if exists public.habita_principal(uuid);
drop table if exists public.agency_admin_transfers;
drop table if exists public.agency_access_requests;
drop trigger if exists habita_default_principal on public.agencies;
drop function if exists public.habita_default_principal();
alter table public.agencies drop column if exists principal_id;
commit;
```

## 4. PostHog

Los eventos salen del navegador con `track()`, así que respetan la exclusión de tráfico interno. No envían emails.

| Evento | Dónde |
| --- | --- |
| `workspace_access_started` / `workspace_access_completed` / `workspace_created` | Al activar el espacio (franja de visita, `/panel/empezar`) |
| `workspace_access_denied` | Falla al activar, o llegada a «Solicitar acceso» (`reason`) |
| `workspace_invitation_sent` / `workspace_invitation_accepted` | Equipo y accesos / `/panel/unirme` |
| `workspace_access_requested` / `workspace_access_approved` | Solicitar acceso / aprobación |
| `workspace_admin_transfer_requested` / `workspace_admin_transfer_completed` | Administración |

Propiedades: `agency_id`, `user_role`, `entry_point`, `demo_id` (cuando corresponde), `is_first_member`, `is_existing_workspace`. Los eventos anteriores (`panel_claim_completed`, `agency_claimed`, …) se mantienen para no romper los embudos.

## 5. Límites conocidos

- No se envían emails: la invitación es un enlace para compartir y el aviso a los administradores es el contador en la navegación más la lista en «Equipo y accesos».
- Solo la cuenta de facturación compra. Para que cualquier administrador compre para la inmobiliaria hace falta un checkout «a nombre de la inmobiliaria» (orden y créditos para `owner_id`). Afecta Mercado Pago y suscripciones, así que queda fuera de este cambio. Cambiar la cuenta de facturación es una operación de soporte.
- El equipo no tiene todavía una pantalla en `/admin` para las solicitudes de acceso y transferencia. Están las rutas `GET`/`POST /api/admin/inmobiliarias/<id>/administracion`.
- Una cuenta sigue perteneciendo a una sola inmobiliaria (restricción existente `agency_members_one_agency`).
- Falta probar con Supabase real (staging). Las funciones SQL se probaron con PGlite y las rutas con dobles en memoria.
