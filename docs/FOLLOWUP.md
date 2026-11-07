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

- **Editar** cambia el texto, el disparador, el canal, los call to actions o las observaciones de esa misma versión, que conserva su número y sus números. `edited_at` guarda cuándo cambió el texto (las observaciones solas no cuentan): sus números juntan el texto anterior y el nuevo. Para comparar dos textos, **Nueva versión**. Una versión no se borra ni cambia de etapa o de número (un trigger lo rechaza).
- **Observaciones** (`notes`), debajo de cada mensaje: indicaciones para la extensión (cuándo mandarlo, qué revisar en el chat, qué hacer si no coincide). Se muestran también al ejecutar.
- Por etapa hay una **activa** y, como mucho, una **a prueba**. Con una prueba, la mitad de las inmobiliarias de la etapa recibe la de prueba (reparto estable por inmobiliaria). Una inmobiliaria que ya empezó con una versión sigue con esa mientras esté vigente.
- La migración crea la V1 de cada etapa, activa.
- Variables: `{{inmobiliaria}}`, `{{decisor}}` (el primer nombre del contacto; la planilla suele tener una categoría como «Por confirmar», que no cuenta: sin nombre, la variable se saca con su coma), `{{sdr}}` (el SDR de la cuenta, o el primer nombre de quien envía), `{{demo}}` (su última demo publicada, el mismo link que «Demo» en la lista: con código para reclamarla si no tiene cuenta) y `{{panel}}` (el enlace fijo a su panel). Una variable sin valor queda visible y bloquea el envío.

## La lista de cada etapa

Ordenada siempre por **score**, de mayor a menor (sin score, al final; a igual score, primero las pendientes con WhatsApp y las que esperan hace más). Columnas:

- **Score:** en «No contactado», el de su cuenta de prospección (lo carga la extensión con la lista) y se edita en la fila, con la misma función que el resto de prospección (`habita_prospect_update`). En una inmobiliaria agregada a mano, sin cuenta de prospección, se guarda en `followup_agencies`. En las demás etapas es el lead score, solo lectura.
- **Inmobiliaria** y su decisor, **dirección** y **zona** (de su cuenta de prospección o, si se agregó a mano, las que se cargaron), **web** y **propiedades** (sus demos, como en Inmobiliarias).
- **Estado:** la etapa, editable. La extensión la revisa con el chat antes de ejecutar y la corrige si no coincide; también «Sacar de Follow-up». La corrección (`followup_agencies.stage_override`) vale mientras el embudo siga en el mismo paso que cuando se corrigió: si después pasa algo real (un envío, una visita, la cuenta), manda el embudo. Elegir la etapa del embudo saca la corrección. Para la medición cuenta el paso de la etapa corregida.
- **Última acción y fecha:** lo más reciente entre las ejecuciones de Follow-up (enviado, WhatsApp abierto o «no se envió», con el motivo), los envíos de prospección (Adquisición, Chapa) y lo que hizo la inmobiliaria (visita, respuesta, cuenta). Sin nada de eso, cuándo entró a la lista. En rojo, con más de 5 días.
- **WhatsApp**, el estado de la ejecución y la versión que le toca.

**Agregar inmobiliaria:** nombre, WhatsApp, decisor, score (en «No contactado»), dirección, zona, web y etapa. Se crea como «Nueva inmobiliaria», con su control de repetidas, y queda en esa etapa hasta que su embudo avance.

## Script

Follow-up → **Script** (`/admin/follow-up/script`): un solo texto, el guion general que la extensión lee antes de trabajar (tono, qué revisar, cuándo corregir el estado, qué hacer si algo no coincide). Las indicaciones de un mensaje puntual van en sus observaciones. Se guarda en `followup_script`.

## Ejecución

Cada etapa lista sus inmobiliarias: primero las pendientes con WhatsApp, después las que no tienen número y al final las ya enviadas; dentro de cada grupo, las que esperan hace más tiempo. «Ejecutar» arma el mensaje para esa inmobiliaria (su WhatsApp, sus links) sin registrar nada. Después:

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

## Extensión de Chrome

Opera la misma pantalla con la sesión del equipo, como la pestaña Ejecución de Adquisición. Selectores estables:

- `data-testid="followup-stage"` con `data-stage` (la clave de la etapa).
- `data-testid="followup-item"` con `data-agency`, `data-status` (`pending`, `opened`, `sent`, `failed`), `data-version` y `data-score`.
- En la fila: `followup-score` (en «No contactado»), `followup-stage-select` (el estado) y `followup-last-action`.
- Al ejecutar: `followup-execute`, `followup-message`, `followup-notes` (las observaciones), `followup-open`, `followup-confirm`, `followup-failed`, `followup-failed-reason`, `followup-failed-save`, `followup-link-demo`, `followup-link-panel`.
- Agregar: `followup-add` y `followup-add-form`. Versiones: `followup-version-edit`, `followup-version-body`, `followup-version-notes`, `followup-version-save`. Script: `followup-script` y `followup-script-save`.

Flujo: leer el Script, abrir la etapa, tomar la primera de la lista (la de mayor score), revisar en el chat que el estado sea el correcto (si no, corregirlo con `followup-stage-select`) y mirar la última acción. Después «Ejecutar», leer `followup-message` y `followup-notes`, abrir WhatsApp, enviar, volver y «Confirmar envío». Debe detenerse si el número del chat no coincide con el mostrado, si el mensaje muestra una `{{variable}}` sin completar o si la sesión venció.

## API (equipo)

- `POST /api/admin/follow-up/ejecuciones` `{ accion: "preparar", inmobiliaria, etapa }` y `{ accion: "registrar", inmobiliaria, etapa, version, estado, motivo?, texto? }`.
- `POST /api/admin/follow-up/versiones` `{ stage, channel, trigger, body, ctas, notes, status }`, `PUT { id, channel, trigger, body, ctas, notes }` (editar) y `PATCH { id, status }`.
- `POST /api/admin/follow-up/inmobiliarias` `{ accion: "etapa", inmobiliaria, etapa }`, `{ accion: "score", inmobiliaria, score }` y `{ accion: "agregar", etapa, key, name, … }`.
- `GET` y `PUT { body }` en `/api/admin/follow-up/script`.
