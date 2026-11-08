# Follow-up

`/admin/follow-up`, debajo de Inmobiliarias en el panel del equipo. Una **next best action** por cada etapa del embudo, con las inmobiliarias que esperan en cada una y los números de cada versión, para iterar los mensajes con datos.

## Etapas

Son los que «se quedaron» en cada paso del embudo de Inmobiliarias (la parte naranja de cada barra, con «Todo»), más las cuentas de prospección todavía sin contactar:

| Etapa | Paso del embudo | Convierte cuando pasa a |
| --- | --- | --- |
| No contactado | — (cuenta de prospección sin contacto) | Contactados |
| Contactado, no responde | Contactados | Interesados |
| Interesado, sin demo | Interesados | Demos creadas |
| Demo creada, sin enviar | Demos creadas | Enviadas |
| Enviada, no abrió | Enviadas | Con visita |
| Visitó, sin interactuar | Con visita | Con interacción |
| Interactuó, sin cuenta | Con interacción | Cuenta creada |
| Cuenta creada, sin uso | Cuenta creada | Cuenta con interacción |
| Cuenta activa, sin suscripción | Cuenta con interacción | Suscripciones |

El paso de cada inmobiliaria es el mismo cálculo que `/admin/inmobiliarias` (`commercialRows` + `agencyStep`). Quedan afuera las de prueba (QA), las perdidas («No interesado»), las que tienen una baja de prospección y las suscriptas. Lógica pura en `src/lib/followup/stages.ts`; lectura y escritura en `src/lib/followup/server.ts`.

## Versiones

`followup_versions` (migración `202611300001_followup.sql`): por etapa, el texto, el canal (WhatsApp o tarea del equipo), cuándo se dispara (texto para el equipo) y los call to actions (Abrir WhatsApp, Link demo, Link panel, Copiar mensaje, Crear demo).

- **Editar Vn** cambia el texto, el disparador, el canal, los call to actions y las observaciones de una versión guardada, sin cambiar su número. Si cambia el texto (no las observaciones), queda `edited_at` y la pantalla avisa que sus números juntan el texto anterior y el nuevo. Para comparar dos textos de verdad, **Nueva versión**. Una versión no se borra ni cambia de etapa o de número (un trigger lo rechaza).
- **Observaciones** (`notes`, debajo del mensaje): indicaciones para la extensión sobre cuándo y cómo mandarlo. Aparecen junto al mensaje al ejecutar (`followup-notes`).
- Por etapa hay una **activa** y, como mucho, una **a prueba**. Con una prueba, la mitad de las inmobiliarias de la etapa recibe la de prueba (reparto estable por inmobiliaria). Una inmobiliaria que ya empezó con una versión sigue con esa mientras esté vigente.
- La migración crea la V1 de cada etapa, activa.
- Variables: `{{inmobiliaria}}`, `{{decisor}}` (el primer nombre del contacto; la planilla suele tener una categoría como «Por confirmar», que no cuenta: sin nombre, la variable se saca con su coma), `{{sdr}}` (el SDR de la cuenta, o el primer nombre de quien envía), `{{demo}}` (su última demo publicada, el mismo link que «Demo» en la lista: con código para reclamarla si no tiene cuenta) y `{{panel}}` (el enlace fijo a su panel). Una variable sin valor queda visible y bloquea el envío.

## Ejecución

Cada etapa lista sus inmobiliarias **ordenadas por score, de mayor a menor** (sin score, al final; a igual score, primero las pendientes con WhatsApp y las que esperan hace más tiempo). Columnas: Score, Inmobiliaria (con decisor), Dirección y zona, Web, Propiedades, Estado, Última acción y fecha, WhatsApp y la acción.

- **Score**: en «No contactado» es el de la cuenta de prospección (lo carga la extensión con la lista) y se edita en la fila (`habita_prospect_update`; las agregadas a mano sin cuenta lo guardan en `followup_agencies`). En las demás etapas es el lead score, solo lectura.
- **Dirección, zona y web**: de la cuenta de prospección y de la ficha de la inmobiliaria (las agregadas a mano, de `followup_agencies`).
- **Estado**: la etapa en Follow-up, editable (o «Sacar de Follow-up»). La extensión lo revisa al ejecutar y lo corrige si no coincide con el chat. Una corrección vale mientras el embudo siga diciendo lo mismo que cuando se hizo; si después pasa algo real (un envío, una visita, una cuenta), vuelve a mandar el embudo. La fila dice «Corregido a mano».
- **Agregar inmobiliaria**: nombre, WhatsApp, decisor, score (en «No contactado»), dirección, zona y web. Se crea como «Nueva inmobiliaria» (con el control de repetidas) y queda en esa etapa hasta que su embudo avance.

**Última acción y fecha**: cada fila muestra: lo más reciente entre Follow-up (envío confirmado o «No se envió», en cualquier etapa), Adquisición (mensajes de la secuencia enviados) y lo que hizo la inmobiliaria (la misma «Última actividad» de `/admin/inmobiliarias`). Se calcula en el servidor (`lastActionOf` en `stages.ts`) y es la que ordena «las que esperan hace más tiempo». Un envío solo abierto no cuenta. En rojo si pasaron más de 5 días. «Ejecutar» arma el mensaje para esa inmobiliaria (su WhatsApp, sus links) sin registrar nada. Después:

1. **Abrir WhatsApp con el mensaje**: `wa.me` con el número y el texto. Queda como «Abierto».
2. **Confirmar envío**: cuenta como ejecución y abre la siguiente inmobiliaria pendiente.
3. **No se envió** (con motivo): no cuenta.

El número es el WhatsApp de prospección (el revisado primero) o, si no hay, el de la ficha de la inmobiliaria. Confirmar también mueve el resto del panel:

- En «No contactado» y «Contactado, no responde», registra el envío en Adquisición con las reglas de siempre (`recordSend`, la misma función que «Mandé el mensaje» de Chapa Labs: contacto revisado, bajas, secuencia de tres pasos).
- En «Demo creada, sin enviar», marca sus demos como enviadas.

Si eso falla (por ejemplo, el número está por revisar), la ejecución queda registrada igual y se avisa qué falta.

`followup_executions` guarda una fila por versión e inmobiliaria, con el paso del embudo en que estaba. Una ejecución enviada no vuelve atrás.

## Medición

- **Ejecuciones**: envíos confirmados con esa versión, una vez por inmobiliaria.
- **Conversiones**: de esas, las inmobiliarias cuyo paso de hoy supera el que tenían al enviarla.
- **Tasa de conversión**: conversiones ÷ ejecuciones. Con menos de 30 ejecuciones dice «muestra chica»; «MEJOR» se marca solo entre versiones con 30 o más.

No hay ventana de tiempo: el embudo no guarda cuándo se llegó a cada paso, así que la conversión es «avanzó después del envío», sin plazo.

## Script

`/admin/script`, debajo de Follow-up en el menú: un solo texto (`followup_script`, hasta 20.000 caracteres) que la extensión lee antes de trabajar. Las indicaciones de cada mensaje van en sus observaciones.

## Extensión de Chrome

Opera la misma pantalla con la sesión del equipo, como la pestaña Ejecución de Adquisición. Selectores estables:

- `data-testid="followup-stage"` con `data-stage` (la clave de la etapa).
- `data-testid="followup-item"` con `data-agency`, `data-status` (`pending`, `opened`, `sent`, `failed`) y `data-version`.
- `followup-item` también trae `data-score`, `data-stage`, `data-last-action`, `data-last-action-at` y `data-last-action-source` (`followup`, `adquisicion`, `inmobiliaria`).
- `followup-score` (input, solo en «No contactado»), `followup-stage-select`, `followup-last-action`, `followup-add`, `followup-add-form`, `followup-notes`, `followup-edit-version`, `followup-version-notes`, `followup-script`, `followup-script-save`.
- `followup-execute`, `followup-message`, `followup-open`, `followup-confirm`, `followup-failed`, `followup-failed-reason`, `followup-failed-save`, `followup-link-demo`, `followup-link-panel`.

Flujo: leer el script (`GET /api/admin/follow-up/script`), abrir la etapa, revisar estado y última acción, «Ejecutar» en la primera pendiente, leer `followup-message`, abrir WhatsApp, enviar, volver y «Confirmar envío». Debe detenerse si el número del chat no coincide con el mostrado, si el mensaje muestra una `{{variable}}` sin completar o si la sesión venció.

## API (equipo)

- `POST /api/admin/follow-up/ejecuciones` `{ accion: "preparar", inmobiliaria, etapa }` y `{ accion: "registrar", inmobiliaria, etapa, version, estado, motivo?, texto? }`.
- `POST /api/admin/follow-up/versiones` `{ stage, channel, trigger, body, ctas, status, notes }`, `PUT { id, channel, trigger, body, ctas, notes }` (editar) y `PATCH { id, status }`.
- `POST /api/admin/follow-up/inmobiliarias` `{ accion: "estado", inmobiliaria, etapa }` (etapa o `fuera`), `{ accion: "score", inmobiliaria, score }` y `{ accion: "agregar", etapa, key, name, whatsapp?, contact?, score?, address?, zone?, website?, confirmDuplicates? }`.
- `GET` y `PUT { body }` `/api/admin/follow-up/script`.

## Migraciones

`202611300001_followup.sql` (versiones y ejecuciones) y `202612010001_followup_edit.sql` (versiones editables con observaciones, `followup_agencies` y `followup_script`).

## Fase 1 — Cola de ejecución confiable

Primera de las fases del brief «Follow-up Execution Center» (aprobación por tanda real de 10 inmobiliarias antes de la siguiente). Migración `202612020001_followup_queue.sql`.

### Modelo

Cada inmobiliaria tiene cuatro datos independientes; el embudo sigue con sus 9 etapas.

- **Etapa** (`stage`): la del embudo, como antes (o la corregida a mano).
- **Situación** (`situation`): qué pasó en la conversación. Sin respuesta, Confirmó número, Interesado, Neutro, Pregunta precios, Pide más adelante, Derivó, Rechazo, No interesado (con proveedor), No contactar, Sin WhatsApp, Número incorrecto. Sale de los datos (`derivedSituation` en `src/lib/followup/plan.ts`: baja, cuenta perdida con su motivo, «Estado» de la hoja, números inválidos, etapa de prospección), así la hoja queda migrada sin copiarla. Una situación marcada a mano vale mientras el embudo siga en el mismo paso, y además se registra en Adquisición: respuesta, interés, pérdida, baja o número inválido.
- **Próxima acción** (`action`, fija por código en esta fase, `nextAction`): la de la etapa («Saludo» en No contactado). Confirmó número → **Presentación**. Pregunta precios → **Precios**. Interesado, Neutro, Pide más adelante y Derivó se resuelven a mano (la bandeja llega en la Fase 2). Las cerradas no tienen acción. Presentación y Precios son acciones de «Contactado, no responde» con sus propias versiones A/B; un texto con líneas `---` son varios mensajes seguidos.
- **Estado de ejecución**: pendiente, tomada, abierta, enviada, no salió, bloqueada.

### La cola

Arriba de las etapas, una sola cola con lo que se puede ejecutar ahora, por grupo (respuestas, demos, seguimientos, contactos nuevos) y dentro de cada uno por score y antigüedad. Queda afuera, con el motivo a la vista en su etapa (**Bloqueada**):

- sin acción para su situación, o sin texto para la acción;
- No contactado que ya fue contactado (fecha de envío en la hoja, o un envío nuestro);
- posible duplicado (mismo número o mismo nombre que otra ya contactada; solo en el primer contacto);
- respuesta ya contestada (le escribimos después de su última respuesta);
- seguimiento a menos de 48 h de nuestro último mensaje;
- el mensaje lleva `{{demo}}` y no tiene demo publicada;
- sin WhatsApp;
- tope de 50 conversaciones nuevas en 24 h;
- fuera de horario (hora de Argentina: contactos nuevos de lunes a sábado de 9 a 18; el resto hasta las 19).

Un número «por revisar» no bloquea: el agente confirma en el chat que es la inmobiliaria y **al confirmar el envío el número queda validado** (y el envío se registra en Adquisición). Si el número no tiene WhatsApp, «No se envió» con «No tiene WhatsApp» o «Número incorrecto» lo invalida y la saca de la cola.

`{{inmobiliaria}}` usa el **nombre corto**: el cargado a mano o el de la ficha sin lo que va entre paréntesis ni la forma societaria (`shortName`). Se cambia desde el detalle de ejecución.

### Tomar una inmobiliaria

Al ejecutar, la sesión la toma 10 minutos (`followup_claims`, `habita_followup_claim`). Otra sesión ve «Tomada» y no puede tomarla. Al confirmar, marcar que no salió o soltarla, queda libre; si la sesión se corta, vuelve a la cola al vencer y, si ya se había abierto WhatsApp, avisa «revisá el chat antes de reenviar». Confirmar es idempotente. La fila confirmada no se mueve: «Siguiente pendiente» abre la próxima. «Abrir WhatsApp» usa `web.whatsapp.com/send` en una sola pestaña (ventana con nombre `habita-whatsapp`).

### API del agente (`/api/admin/followup/*`, sesión del equipo, JSON)

- `GET queue?limite=50` → `{ summary, next, queue, blocked }`: la próxima libre para esta sesión, las ejecutables en orden y las bloqueadas con su motivo.
- `POST claim` `{ inmobiliaria? }` → la toma y devuelve el mensaje armado (`messages`, `whatsappUrl`, `warnings`, `notes`, `versionId`, `action`). Sin `inmobiliaria`, la próxima libre: dos sesiones que piden a la vez reciben inmobiliarias distintas. `null` si no queda ninguna.
- `POST open` `{ inmobiliaria, etapa, tarea, version }` → abierta (no cuenta como enviada).
- `POST confirm` `{ inmobiliaria, etapa, tarea, version, texto }` → la ejecución, el aviso si algo no se pudo registrar y la inmobiliaria como quedó.
- `POST fail` `{ inmobiliaria, etapa, tarea, version, motivo, tipo? }` (`sin_whatsapp`, `numero_incorrecto`).
- `POST situation` `{ inmobiliaria, situacion, texto? }` (texto original de la respuesta).
- `POST release` `{ inmobiliaria }`.

Si la etapa, la acción o la versión cambiaron desde que se leyó la cola, la API responde 409 con el motivo: el agente actualiza y sigue.

### Selectores nuevos

`followup-queue`, `followup-queue-item` (`data-agency`, `data-stage`, `data-action`, `data-situation`, `data-status`), `followup-situation-select`, `followup-blocked`, `followup-row-status`, `followup-exec`, `followup-phone`, `followup-message` (uno por mensaje, `data-index`), `followup-copy-part`, `followup-check`, `followup-error`, `followup-failed-kind`, `followup-next`, `followup-release`, `followup-short-name`, `followup-kpi-ready`, `followup-kpi-blocked`, `followup-kpi-new`. Cada `followup-item` suma `data-situation`, `data-action` y `data-blocked`.

### Corrección del 07/11

De las 10 ejecuciones del 07/11, 9 no se habían registrado en Adquisición (número «por revisar»). Se registraron como saludo enviado, con el número validado y la hora real en la evidencia.

### Ajuste a la especificación de Astra (pantallas 1 y 2 del diseño)

Migración `202612030001_followup_priority.sql`.

- **Pestañas**: Cola de ejecución (por defecto), Respuestas (Fase 2), Embudo (las etapas con sus inmobiliarias), Mensajes y reglas (los editores de cada acción) y Resultados (las versiones). `?vista=embudo|reglas|resultados`.
- **KPIs que filtran la cola**: Acciones para hoy (ejecutables y libres), Respuestas nuevas (respondieron y esperan acción), Demos pendientes y Bloqueadas (con el conteo por motivo).
- **Prioridad Alta, Media o Baja**: sale del grupo (respuestas y demos, alta; seguimientos, media; contactos nuevos, baja). Se cambia a mano desde el detalle (`followup_agencies.priority`); la cola ordena por prioridad, grupo, score y antigüedad.
- **Detalle de ejecución en 3 sectores**: la cola a la izquierda; en el centro la inmobiliaria (etapa, situación editable, contexto, nombre en el mensaje), las últimas acciones (Follow-up, Adquisición y sus respuestas con el texto) y los mensajes paso a paso con copiar; a la derecha el checklist (número validado, sin rechazo, sin mensaje reciente, horario, variables, enlaces, mensaje listo), Abrir WhatsApp, Confirmar, No se envió, **Omitir o reprogramar** (mañana, 3 días, una semana u otra fecha, con motivo), enlaces rápidos, prioridad y el aviso de no enviar si el chat no coincide.
- **Reprogramada**: sale de la cola hasta la fecha (`snooze_until`) y figura en Bloqueadas con «Volver a la cola».
- API: `POST /api/admin/followup/snooze` `{ inmobiliaria, hasta?, motivo? }` (o `{ inmobiliaria, volver: true }`) y `POST /api/admin/followup/priority` `{ inmobiliaria, prioridad }`. `claim` devuelve además `checklist`, `history` y `context`.
- Selectores: `followup-tabs`, `followup-tab-<vista>`, `followup-kpi-listas|respuestas|demos|bloqueadas`, `followup-take-next`, `followup-detail`, `followup-back`, `followup-history`, `followup-checklist` (cada `li` con `data-check` y `data-ok`), `followup-snooze`, `followup-snooze-form`, `followup-snooze-save`, `followup-unsnooze`, `followup-priority`, `followup-stop`, `followup-block-reasons`. Cada `followup-queue-item` suma `data-priority` y `data-blocked`.

## Fase 2 — Bandeja de respuestas y seguimientos programados

Migración `202612040001_followup_replies.sql`. Construida a pedido antes de la aprobación de la tanda de la Fase 1.

### Secuencias (fijas por código, `nextAction` en `plan.ts`)

La acción es el momento de la secuencia y la versión, la variante del mensaje: cada paso tiene sus propias versiones A/B.

| Situación | Pasos | Espera desde nuestro último mensaje |
| --- | --- | --- |
| No contactado | Saludo | — |
| Sin respuesta, Neutro o Pide más adelante («Contactado, no responde») | Saludo sin respuesta → Seguimiento 2 → fin | 48 h, después 72 h |
| Enviada, no abrió | Seguimiento de demo 1 → Seguimiento de demo 2 → fin | 24 h, después 72 h |
| Confirmó número o Derivó | Presentación → Presentación sin respuesta → fin | ya, después 48 h |
| Pregunta precios | Precios → esperar | ya |
| Otras etapas | Su next best action → fin | 48 h |
| Interesado | nada: preparar la demo | — |
| Rechazo, No contactar, Sin WhatsApp, Número incorrecto | nada | — |

Un paso que todavía no venció queda **Programado** («Programada para el …») y no entra a la cola; el vencimiento se calcula al leer la cola, sin cron. Si avanza de etapa (visita, cuenta) o responde, la secuencia cambia sola. Después del último paso, la secuencia termina: no hay reintentos infinitos. Los textos de «Saludo sin respuesta», «Presentación sin respuesta» y el segundo seguimiento de demo los define Facu: sin texto, la acción queda bloqueada y no se manda nada.

### Bandeja de respuestas

`followup_replies`: cada respuesta de WhatsApp con su texto original, la hora, la clasificación y la confianza.

- La extensión la registra con `POST /api/admin/followup/reply` `{ inmobiliaria, texto, hora?, clasificacion?, confianza?, hasta?, contactoNombre?, contactoWhatsapp? }`. Clasificaciones: confirmo_numero, interesado, neutro, pregunta_precios, mas_adelante, derivo, rechazo, proveedor_ia, no_contactar, audio, pregunta_no_cubierta.
- Con clasificación y confianza ≥ 70 % se aplica sola: la situación (registrada en Adquisición con el texto como evidencia) y la próxima acción. Un audio, una pregunta no cubierta o confianza baja va **a Facu** y no se manda nada. Sin clasificación queda en la bandeja.
- Mientras tenga una respuesta sin resolver, la inmobiliaria queda bloqueada en la cola y se suelta si alguien la tenía tomada.
- «Pide más adelante» con fecha la reprograma. «Derivó» con un contacto nuevo lo suma a la misma inmobiliaria (cuenta de prospección), como contacto principal, sin duplicarla.
- Resolver una de la bandeja: `POST …/reply` `{ id, clasificacion, … }` o `{ id, facu: true }`. Listarla: `GET /api/admin/followup/replies`.
- Pestaña **Respuestas**: la lista y el detalle (texto, clasificación sugerida y su confianza, fecha o contacto nuevo según el caso, «Guardar y pasar a la cola», «Asignar a Facu») y «Registrar una respuesta» a mano.
- Selectores: `followup-inbox`, `followup-reply` (`data-reply`, `data-status`), `followup-reply-detail`, `followup-reply-save`, `followup-reply-facu`, `followup-reply-add`, `followup-reply-form`.

## Fase 3 — Reglas configurables, demos en la cola y auditoría

Migración `202612050001_followup_rules.sql`.

### Reglas (`followup_rules`, `src/lib/followup/rules.ts`)

La next best action sale de reglas guardadas en la base, editables en **Mensajes y reglas** sin deploy. Una regla: etapa, situaciones (vacía: cualquiera), paso, espera en horas desde nuestro último mensaje, paso previo (opcional), orden, ventana horaria (hora de Argentina) y días, activa o apagada. Gana la primera regla (por orden) que corresponde a la situación, cuyo paso no salió y cuyo paso previo sí; sin ninguna, la secuencia terminó.

- Se sembraron iguales a las reglas fijas de la Fase 2 (`DEFAULT_RULES`; un test compara la migración con el código), salvo **crear demo** y **enviar demo**, que pasan a salir enseguida.
- Fijo en código, por seguridad: a un rechazo, un «no contactar» o un número sin WhatsApp no se le escribe nunca, haya la regla que haya; un interesado en las dos primeras etapas pasa a preparar la demo.
- La ventana horaria de la regla reemplaza a la general.
- `GET` y `PUT /api/admin/follow-up/reglas` (`{ key?, stage, situations, action, after_hours, after_action, position, enabled, hours_from, hours_to, days }`).

### Mensajes

- Cada paso tiene su editor con **vista previa** resuelta con una inmobiliaria de la etapa; marca las variables que quedarían sin resolver.
- Una versión con una variable desconocida no se guarda.

### Demos en la cola

- **Demo prometida**: una inmobiliaria que mostró interés con la demo por crear o por enviar va primera en la cola, con prioridad alta, y el checklist marca si van más de 30 minutos desde el interés.
- «Interesado, sin demo»: el checklist suma «Propiedad elegida e importada» y «Demo generada, revisada y publicada», que el panel verifica solo; al publicarla pasa sola a «Demo creada, sin enviar», cuyo paso (enviar la demo) sale enseguida.

### Embudo y etapas

La pestaña **Embudo**: las 9 etapas en tarjetas con cuántas esperan y qué parte de las que llegaron pasó a la siguiente; la elegida muestra sus reglas (situaciones, paso, espera, versión activa, conversión, prueba A/B) y sus inmobiliarias.

### Auditoría (`followup_audit`)

Quién cambió qué y cuándo: etapa, situación (con el texto), score, prioridad, reprogramación, nombre corto, reglas y versiones. Los cambios de cada inmobiliaria aparecen en sus «Últimas acciones»; los de reglas y mensajes, al pie de Mensajes y reglas.

Selectores: `followup-funnel`, `followup-funnel-stage`, `followup-funnel-rule`, `followup-rules`, `followup-rule`, `followup-rule-edit`, `followup-rule-form`, `followup-rule-hours`, `followup-rule-save`, `followup-rule-add`, `followup-preview`, `followup-changes`.

## Fase 4 — Resultados, atribución y cohortes

Migración `202612060001_followup_results.sql`. Lógica pura en `src/lib/followup/results.ts`.

- **Cuándo convirtió**: el embudo no guarda cuándo se llegó a cada paso. Cada ejecución guarda `converted_at` (y `converted_step`) la primera vez que el panel ve que la inmobiliaria avanzó: la hora exacta cuando se conoce (el interés registrado, la demo creada) o, si no, ese momento. Las conversiones anteriores a esta fase quedan con la hora en que se vieron por primera vez.
- **Ventana**: 7 días, 14 días o sin límite desde el envío.
- **Atribución al último mensaje**: si varios mensajes de la misma etapa precedieron a una conversión, cuenta solo el último antes de ella; los otros son asistencias. Una conversión nunca suma dos veces.
- **Por regla y versión**: elegibles (ejecutadas + las que hoy esperan esa versión), ejecutadas, conversiones (+ asistencias), tasa, tiempo mediano a la conversión, «No salieron» y muestra. «MEJOR» solo entre versiones con 30 o más ejecutadas (el mínimo es a confirmar con Facu).
- **Evolución semanal**: ejecutadas por semana de envío y conversiones atribuidas por semana de conversión (semanas de lunes a domingo, hora de Argentina).
- **Cohortes**: por semana de primer contacto, por semana de primera respuesta y por versión del saludo; cuántas respondieron, mostraron interés, recibieron la demo, crearon la cuenta y se suscribieron.
- **Motivos de bloqueo** agregados.
- **Tráfico interno**: la actividad de producto (visitas e interacción de las demos) ya lo excluye (`docs/TRAFICO_INTERNO.md`); las acciones comerciales no se excluyen.
- **Caso I (suscripción)**: una inmobiliaria suscripta sale de Follow-up (no tiene etapa), así que no le queda ninguna tarea de captación; su historial (ejecuciones, respuestas, auditoría) se conserva.
- **Opcional, decisión aparte**: la API de WhatsApp Business permitiría detectar respuestas sin una pestaña abierta (costo, plantillas aprobadas por Meta y reglas propias).
- Selectores: `followup-results`, `followup-window-7|14|todo`, `followup-results-versions`, `followup-results-blocks`, `followup-results-cohorts`, `followup-cohort-contacto|respuesta|version`.

## Desde Chapa Labs (servidor a servidor)

El panel comercial de Chapa Labs (`/prospecting`, «Hoy» con Avita y Turnia juntas) opera este mismo Follow-up por `/api/prospeccion`, con `Authorization: Bearer $PROSPECTING_API_SECRET` (o `$METRICS_SECRET`). Lógica en `src/lib/followup/chapa.ts`: llama a las mismas funciones que `/api/admin/followup/*`, con los mismos campos, así las reglas, los claims, la auditoría y los resultados son los mismos.

- `GET ?vista=followup` → `{ summary, queue, blocked, scheduled, inbox, funnel, stages, rules, results, changes }`.
- `POST { by, followup: { op, ... } }` con `op` = `queue`, `claim`, `open`, `confirm`, `fail`, `release`, `situation`, `reply`, `replies`, `snooze`, `priority`, `version-create`, `version-update`, `version-status` o `rule-save`.
- **Quién opera**: `by` es el nombre de quien opera en Chapa. Se usa el usuario del equipo (ADMIN_EMAILS) cuyo nombre coincide (el mismo que da `{{sdr}}`), así el claim, la ejecución y la auditoría quedan a su nombre. Si nadie coincide, queda a nombre del usuario por defecto de la API (`PROSPECTING_ACTOR_ID`) con el nombre que mandó Chapa, y un claim de otra persona con ese mismo usuario igual frena la operación (409).
