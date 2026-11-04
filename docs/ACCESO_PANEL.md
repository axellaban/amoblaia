# Acceso al panel: enlace fijo y modo exploración — 4 de noviembre de 2026

Rama `claude/loving-rubin-kh1yfi`. Maqueta aprobada: bienvenida variante A (tres opciones, «Crear cuenta» con la aclaración «En un clic con Google · o con tu email»).

**No se aplicó ninguna migración en producción.**

## 1. Qué cambia

| Antes | Ahora |
| --- | --- |
| «Acceso al panel» se armaba desde una demo publicada (`/p/<propiedad>-<código>/panel`) y cada copia creaba un código nuevo de un solo uso. | Un **enlace fijo por inmobiliaria**: `/i/<inmobiliaria>-<código>`. «Copiar link» devuelve siempre el mismo. No depende de ninguna demo. «Cambiar enlace» lo reemplaza y el anterior deja de funcionar. |
| El enlace abría el panel en solo lectura, con la franja «Este es el panel de… Crear mi cuenta». | La primera vez abre el **Inicio** con una bienvenida encima: **Iniciar sesión**, **Crear cuenta** (Google en un clic o email) y **Ver como invitado**. |
| Un código vencido o usado llevaba al registro; el equipo, si fallaba la vista de soporte, iba a `/admin`. | Un enlace cambiado o desconocido muestra «Este enlace ya no está activo» (`/i/inactivo`). Nunca el registro ni `/admin`. |
| Con la sesión iniciada en otra cuenta, el panel de la visita fallaba (404). | Ve el panel como invitado y se le ofrece **«Usar esta cuenta para <inmobiliaria>»** (si todavía no tiene dueño) o se le avisa que ya tiene administrador. |
| La contraseña de la invitación pedía 8 caracteres y la de la home 10. | 10 en los dos lugares. |

Los enlaces anteriores (`/p/…/panel`, `/panel/visita?codigo=`) siguen funcionando como antes.

## 2. Quién abre el enlace y qué ve

| Quién | Resultado |
| --- | --- |
| Sin sesión, primera vez en ese navegador | Inicio de la inmobiliaria con la bienvenida. |
| Sin sesión, ya eligió «Ver como invitado» | Inicio en modo exploración, sin volver a preguntar. |
| Miembro de esa inmobiliaria con sesión | Su Inicio de siempre. |
| Sesión de una cuenta sin inmobiliaria | Panel como invitado + «¿Usás esta cuenta para…?» o «Tu cuenta todavía no tiene acceso». |
| Miembro de otra inmobiliaria | Su propio panel. |
| Equipo de Habita | El panel en la vista de soporte (solo lectura, auditada). |

## 3. Modo exploración

- Se reutiliza el modo visita existente (`src/lib/agency/visit.ts`): cookie firmada con el código, revalidada en cada request. El enlace fijo se busca primero en `agency_panel_links` y después en las invitaciones.
- El panel es el mismo (`AgencyPanel`). Solo se agrega la franja «Modo exploración · Explorá las herramientas de Habita. Para guardar tus cambios, necesitás acceder a tu cuenta.» con «Acceder a mi cuenta».
- Toda escritura devuelve `VisitorError` (403, `code: "visita"`) y abre «Accedé para guardar» con Iniciar sesión / Crear cuenta / Seguir explorando. Después de entrar, vuelve a la misma pantalla.
- Ninguna lectura sensible cambia: Usuarios, Cuenta y las escrituras siguen exigiendo cuenta en el servidor.

## 4. Autenticación

- **Iniciar sesión** lleva a `/acceso` con la tarjeta de siempre («Entrá a habita.», Google primero). Si viene del enlace, la tarjeta nombra la inmobiliaria, ofrece email y contraseña debajo de Google y tiene «Olvidé mi contraseña», «Crear cuenta» y «Ver como invitado». Desde la home no cambia nada.
- **Crear cuenta** usa el registro de la invitación (`/panel/empezar`), con Google o email: el enlace fijo genera para eso una invitación de un solo uso (2 días), a nombre de quien creó el enlace, solo si la inmobiliaria no tiene dueño. Conserva demos, ambientaciones y créditos de regalo.
- **Recuperar contraseña**: el flujo existente; si empezó en el enlace, al guardar la nueva contraseña vuelve al panel.

## 5. Analytics

| Evento | Cuándo | Propiedades |
| --- | --- | --- |
| `panel_shared_link_opened` | Al llegar desde `/i/…` | `apertura`: invitado, sesion, miembro, otra, equipo |
| `panel_entry_choice` | Opción elegida en la bienvenida o en un diálogo | `choice`: iniciar_sesion, crear_cuenta, invitado; `origen` |
| `panel_exploration_home_viewed` | Inicio visto en modo exploración | `sesion` |
| `panel_exploration_section_clicked` | Otra sección abierta | `section`, `origen`: sidebar, barra, contenido |
| `panel_exploration_property_opened` | Una propiedad o demo abierta | `origen`, `vista` |
| `panel_visit_account_asked` | Intentó guardar | `ruta`, `accion` (método y ruta de la API, sin ids) |

Embudo sugerido en PostHog: `panel_shared_link_opened` → `panel_exploration_home_viewed` → (`panel_exploration_section_clicked` o `panel_exploration_property_opened`) → `panel_visit_account_asked` → `panel_claim_completed`. El tráfico interno queda excluido como en el resto de las métricas.

## 6. Migración `202611240001_agency_panel_links.sql`

Aditiva e idempotente: crea `agency_panel_links` (una fila por inmobiliaria, RLS sin políticas). Sin ella, «Acceso al panel» muestra un mensaje que pide aplicarla y el resto sigue igual.

1. Supabase → SQL Editor → pegar y ejecutar el archivo.
2. En `/admin/inmobiliarias/<id>?pestana=enlaces`, «Acceso al panel» muestra el enlace. Copiarlo dos veces da el mismo.
3. Abrirlo en una ventana privada: Inicio con la bienvenida; «Ver como invitado» deja la franja; intentar ambientar una foto abre «Accedé para guardar».

## 7. Límites

- «Solicitar acceso» con aviso al administrador todavía no existe en el código: la pantalla indica que lo pida para que lo sumen desde «Usuarios».
- El equipo ve el enlace en la vista de soporte (sin la bienvenida). Para ver exactamente lo que ve la inmobiliaria, abrirlo en una ventana privada.
- El acceso de empleados (`/panel/unirme`) mantiene su mínimo de 8 caracteres.
- Falta probar con Supabase real (staging): las rutas se probaron con dobles en memoria.
