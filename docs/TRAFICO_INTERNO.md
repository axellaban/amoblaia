# Tráfico interno: exclusión integral

Objetivo: que nada de lo que hagan el equipo y sus cuentas de prueba sume a las métricas
comerciales de Habita, ni en PostHog ni en el panel interno (demos, inmobiliarias, leads).
Los eventos internos **no se borran**: se guardan marcados, para QA.

## 1. Quién es interno

El servidor decide; el navegador solo recibe el veredicto (nunca la lista de correos).

| Orden | Señal | Motivo guardado | Alcance |
| --- | --- | --- | --- |
| 1 | Sesión con una cuenta interna: `ADMIN_EMAILS` o el registro (`internal_identities`, por e-mail o id estable de usuario) | `team_session` | todo lo que haga esa sesión |
| 2 | Sesión con una cuenta **externa** | — | siempre externa, aunque el navegador estuviera marcado (y la marca se borra) |
| 3 | Cookie firmada `habita_dispositivo` (HttpOnly, 1 año) de un dispositivo `internal` | `internal_device` | ese navegador, con o sin sesión |
| 4 | Huella del equipo: IP + user agent exacto + pantalla + zona horaria (HMAC), vista en una visita interna de las últimas 72 h | `team_fingerprint` → el servidor le da su cookie | ventanas incógnito y otros perfiles del mismo dispositivo en la misma red |
| 5 | Marca local del navegador (`habita_internal`, de antes) | `device_hint` | solo excluye a ese navegador; nunca vale para nadie más |

Reglas: `src/lib/internal/shared.ts` (`classify`, puras y testeadas). Servidor:
`src/lib/internal/server.ts` (`classifyRequest`, con caché de 60 s del registro).

**La IP sola nunca clasifica a nadie.** La huella exige las cuatro partes; dos personas con la
misma IP de una operadora solo coinciden si además tienen el mismo navegador, versión,
pantalla y zona horaria, dentro de 72 h.

## 2. Registro central (`/admin/internos`)

- **Personas** (`internal_people`): admin, colaborador o cuenta de prueba; activas o dadas de baja.
- **Cuentas** (`internal_identities`): varios Gmail por persona. Al iniciar sesión se guarda
  también el id estable del usuario. Alta inicial: facundogregorini@gmail.com,
  descstartups@gmail.com y growthlabs86@gmail.com (persona «Equipo Habita»; se pueden separar).
- **Dispositivos** (`internal_devices`): `internal`, `unknown`, `external` (confirmado cliente) o
  `revoked`. Guardan sus alias (`habita_visitante` y `$device_id` de PostHog).
- **Vincular otro dispositivo**: enlace de un solo uso (30 min, solo se guarda su hash). Sirve
  para el celular, una ventana incógnita o un perfil de Chrome nuevo.
- Altas, bajas y cambios se auditan en `admin_audit` y recalculan lo que tocan.
- Agregar un e-mail **no** da acceso al panel del equipo (eso sigue siendo `ADMIN_EMAILS`).

## 3. Sesión, cambio de cuenta y cierre de sesión

- Iniciar sesión con una cuenta interna marca el navegador (cookie firmada + PostHog).
- **Cerrar sesión no desmarca**: es el navegador del equipo, y tiene que seguir siendo interno
  al abrir una demo pública sin sesión.
- **Otra cuenta (externa) en el mismo navegador**: el dispositivo se revoca, se borra la cookie,
  la marca local y la huella, y PostHog arranca una identidad anónima nueva (`reset`). La
  persona interna conserva `is_internal`; la nueva empieza limpia.
- **Computadora de un cliente** donde alguien del equipo inició sesión: «Revocar» en
  `/admin/internos`, o «Dejar de marcar este dispositivo» en `/interno` (después de cerrar sesión).

## 4. PostHog

- Cada evento de un navegador interno lleva `is_internal = true` e `internal_reason`. Se agrega
  de forma **sincrónica en `before_send`**, así que ni el primer `$pageview` sale sin marca (antes
  se perdían eventos mientras cargaba el módulo diferido: 399 en un iPhone del equipo).
- La persona recibe `is_internal = true` una vez por sesión de pestaña (sin `$set` repetidos).
- No se llama a `identify`: los identificadores no cambian salvo en el cambio de cuenta.
- `?habita_interno=1` ya no marca (se podía copiar en un enlace y marcar a un cliente);
  `?habita_interno=0` sigue desmarcando.

Configuración aplicada en el proyecto 683617 (03/11/2026):

| Elemento | Antes | Ahora |
| --- | --- | --- |
| Cohorte 659781 «Internal / Test users» (filtro de cuentas de prueba) | `$internal_or_test_user`, **0 personas** | OR: persona `is_internal = true`, cohorte 688983, `$internal_or_test_user` |
| Cohorte 688983 «Habita · Internos históricos» | — | estática, personas de los 56 dispositivos de la auditoría |
| Filtro de cuentas de prueba del proyecto | solo la cohorte (vacía) | cohorte 659781 **y** evento `is_internal ≠ true`; activado por defecto |
| Dashboard «Demos · Inmobiliarias» | 4 IPs fijas excluidas; 3 insights sin filtro | `is_internal ≠ true` + filtro de cuentas de prueba forzado en todos los gráficos |
| Dashboard «QA · Tráfico interno» (2300576) | — | incluye al equipo: aperturas por `is_internal`, eventos por motivo, monitor de fugas |

## 5. Panel interno: una sola definición

La exclusión está en la capa de datos compartida, no en cada gráfico:

- `internal_visitor_ids` (vista): marcas manuales + alias de dispositivos internos + sus
  `ph:<device>` + los `habita_visitante` que `lead_events` asocia a esos dispositivos.
- `habita_internal_user_ids()`: cuentas del equipo (por id o por e-mail, personas activas).
- `demo_activity_commercial`: actividad de demos sin pasos internos, sin navegadores del equipo y
  sin el paso de cuenta de una inmobiliaria cuyo dueño es una cuenta del equipo.
- `payments_commercial`: pagos sin compras de prueba del equipo.

| Métrica | Dónde | Cómo excluye |
| --- | --- | --- |
| Visitas, interacciones, descargas, generaciones de demos; visitantes únicos | `demo_activity` → `demos.activity_*` | el paso interno se guarda marcado y no mueve el resumen; `habita_recompute_demo_activity` lo rehace desde la vista comercial |
| Clics en estilos, sliders, CTA, precios, registro; recurrencia; Lead Engagement Score | `lead_events` → `lead_visitor_scores` | evento marcado al ingerir + visitante en `internal_visitor_ids` ⇒ visitante interno, fuera del score y de los rollups |
| Ingresos (cuenta creada), registros, importaciones, generaciones del panel, suscripción | `commercial-server.ts` | una inmobiliaria cuyo dueño es una cuenta del equipo cuenta como «sin cuenta» |
| Funnel de demos, etapas comerciales, pestaña Actividad | `commercialRows`, `agencyActivity` | heredan lo anterior |
| `/api/metricas` (dashboard de Chapa Labs) | `demo_activity_commercial`, `payments_commercial` | mismas vistas |

«Demos creadas» y «Enviadas» no cambian: son trabajo del equipo, no actividad de clientes.

## 6. Datos históricos

Auditoría de PostHog del 03/11/2026 (60 días): 8 dispositivos marcados `is_internal`, 4 con
uso del panel `/admin` desde la red del equipo antes de que existiera la marca, y 44 vistos
**solo** desde la red del equipo. La IP sola no alcanza para atribuirlos automáticamente: se
listaron como desconocidos y **el equipo los confirmó como propios** el mismo día.

`202611230002_internal_history.sql` los registra como dispositivos `internal` (origen `backfill`,
con la evidencia de cada uno) y rehace el resumen derivado de las demos. No borra ni modifica
eventos. Los lead scores se rehacen con «Recalcular todo» en `/admin/internos`.

Limitaciones de la atribución histórica:

- Un dispositivo del equipo que nunca usó la red del equipo, nunca se marcó y nunca abrió el
  admin no se puede distinguir de un cliente: sigue contando.
- Si alguno de los 44 resultara de un cliente en la misma red (poco probable: IP fija del equipo),
  se corrige con «Es un cliente» y vuelve a contar.
- Los eventos de PostHog de antes del 30/10 no tienen `is_internal`; quedan excluidos por la
  cohorte (persona), no por el evento.

## 7. Limitaciones vigentes

- **Incógnito con datos móviles**: la IP de la operadora cambia; la huella solo coincide si hubo
  una visita interna reciente con esa misma IP. Respaldo: iniciar sesión o el enlace de vinculación.
- **Primer evento de una ventana incógnita**: el `$pageview` inicial puede salir antes de que el
  servidor reconozca la huella; queda excluido por la cohorte (la persona recibe `is_internal`).
  Los reportes de la demo al servidor esperan el veredicto (hasta 2,5 s).
- Revocar un dispositivo tarda hasta 60 s en verse en otras instancias (caché).
- La huella se renueva en cada visita interna; una ventana incógnita reconocida la mantiene viva.

## 8. Puesta en marcha

1. Aplicar en el SQL Editor de Supabase, en orden:
   `202611230001_internal_traffic.sql` y `202611230002_internal_history.sql`.
2. (Opcional) `INTERNAL_DEVICE_SECRET` en Vercel, 32+ caracteres. Sin ella, la firma se deriva de
   la clave de servicio de Supabase.
3. Desplegar.
4. En `/admin/internos`, «Recalcular todo».
5. QA (sección 9).

## 9. QA manual

Ver el estado de cualquier navegador en `/interno`. En PostHog, «QA · Tráfico interno».

1. Con cada una de las tres cuentas: iniciar sesión → `/interno` dice «tráfico del equipo».
2. Navegador habitual con sesión: abrir una demo → PostHog `is_internal = true`, sin cambios en
   `/admin/inmobiliarias` (visitas ni score).
3. Mismo navegador, cerrar sesión, abrir la demo pública → sigue interno (`internal_device`).
4. Perfil de Chrome nuevo: externo hasta iniciar sesión, abrir un enlace de vinculación o, en la
   misma red, por huella.
5. Incógnito en la misma compu y red, sin sesión → interno por huella (`/interno`).
6. Celular con Wi-Fi (huella) y con datos móviles (enlace de vinculación).
7. Usuario externo real (otro dispositivo y red): cuenta en visitas y score.
8. En un navegador interno, iniciar sesión con una cuenta externa → `/interno` dice externo,
   PostHog arranca otra persona, y su actividad cuenta.
