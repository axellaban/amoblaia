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

- Una versión guardada **no se edita ni se borra** (un trigger lo rechaza). Cambiar algo crea la siguiente: así los números de cada una siguen valiendo.
- Por etapa hay una **activa** y, como mucho, una **a prueba**. Con una prueba, la mitad de las inmobiliarias de la etapa recibe la de prueba (reparto estable por inmobiliaria). Una inmobiliaria que ya empezó con una versión sigue con esa mientras esté vigente.
- La migración crea la V1 de cada etapa, activa.
- Variables: `{{inmobiliaria}}`, `{{decisor}}` (el primer nombre de quien decide), `{{sdr}}` (el SDR de la cuenta, o el primer nombre de quien envía), `{{demo}}` (su última demo publicada, el mismo link que «Demo» en la lista: con código para reclamarla si no tiene cuenta) y `{{panel}}` (el enlace fijo a su panel). Una variable sin valor queda visible y bloquea el envío.

## Ejecución

Cada etapa lista sus inmobiliarias, primero las pendientes y las que esperan hace más tiempo. «Ejecutar» arma el mensaje para esa inmobiliaria (su WhatsApp, sus links) sin registrar nada. Después:

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
- `data-testid="followup-item"` con `data-agency`, `data-status` (`pending`, `opened`, `sent`, `failed`) y `data-version`.
- `followup-execute`, `followup-message`, `followup-open`, `followup-confirm`, `followup-failed`, `followup-failed-reason`, `followup-failed-save`, `followup-link-demo`, `followup-link-panel`.

Flujo: abrir la etapa, «Ejecutar» en la primera pendiente, leer `followup-message`, abrir WhatsApp, enviar, volver y «Confirmar envío». Debe detenerse si el número del chat no coincide con el mostrado, si el mensaje muestra una `{{variable}}` sin completar o si la sesión venció.

## API (equipo)

- `POST /api/admin/follow-up/ejecuciones` `{ accion: "preparar", inmobiliaria, etapa }` y `{ accion: "registrar", inmobiliaria, etapa, version, estado, motivo?, texto? }`.
- `POST /api/admin/follow-up/versiones` `{ stage, channel, trigger, body, ctas, status }` y `PATCH { id, status }`.
