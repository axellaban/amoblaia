# Centro de adquisición comercial (`/admin/prospeccion`)

Fecha: 27/10/2026. Diseño de origen: rama `design/prospeccion-entrega`, carpeta `docs/prototipos/prospeccion/`.
Es una herramienta privada del equipo de habita para trabajar y medir la prospección de inmobiliarias. No envía mensajes por sí sola, no lee bandejas de entrada y no está aplicada en producción.

## 1. Integración con lo existente

| Pieza existente | Cómo se reutiliza |
| --- | --- |
| `agencies` | Es la cuenta comercial. `prospect_accounts.agency_id` es único: una inmobiliaria figura una sola vez, no por propiedad ni por canal. |
| `demos` / `demo_properties` | Se enlazan por `agency_id`. La ficha muestra las demos y su enlace público si están publicadas; `{{demo}}` en una plantilla usa la última publicada. El editor de demos no cambió. |
| `requireAdmin` / `requireAdminPage` (`ADMIN_EMAILS`) | Protegen la página y cada ruta. Las mutaciones validan además el origen. |
| `agency_members`, `generations`, `demo_photos.approved_generation_id`, `payments` | Son la evidencia de servidor para medir activación y compra (ver §5). |
| `amobla_touch_updated_at`, patrón de RPC `security definer` solo para `service_role` | Se usa igual en la migración nueva. |

**Contacto privado y contacto público.** Los contactos comerciales viven en `prospect_contacts` (RLS activa, sin permisos para `anon`/`authenticated`). El contacto público para compradores sigue en `agencies.branding` y nunca se mezcla con los comerciales. Hay un test que comprueba que la ficha pública, el sitio y el panel de la inmobiliaria no leen datos de prospección.

Enlaces: `/administracion` y `/admin/inmobiliarias` llevan a Adquisición. La ficha de cada inmobiliaria tiene el botón «Base de prospección», que la suma a la base o abre la que ya existe.

## 2. Archivos

- `supabase/migrations/202611010001_prospecting.sql`: tablas, triggers append-only, RPC y permisos.
- `src/lib/prospecting/`: `types.ts`, `time.ts` (zona Buenos Aires), `metrics.ts` (reglas de medición, puras), `import.ts` (CSV, mapeo, normalización y vista previa, puras), `render.ts` (plantillas y enlaces de canal), `server.ts` (RPC, errores con código estable y lecturas).
- `src/app/api/admin/prospeccion/**`: dataset, cuentas, eventos, contactos, bajas, intentos, plantillas e importación.
- `src/app/admin/prospeccion/page.tsx` y `src/components/prospecting/*`: las cuatro vistas, la ficha lateral y el importador.
- `src/components/prospecting/add-agency.tsx` y los enlaces en `admin.tsx` y `admin/inmobiliarias`.
- `src/app/globals.css`: estilos `.pr-*` con el lenguaje visual de la maqueta.
- Tests: `tests/prospecting-database.test.ts` (SQL real en PGlite), `tests/prospecting-metrics.test.ts`, `tests/prospecting-import.test.ts`, `tests/prospecting-routes.test.ts` y `tests/fixtures/prospeccion-sintetica.csv`, un archivo sintético con nombres FICTICIA y dominios `.test`.

## 3. Modelo de datos

| Tabla | Contenido |
| --- | --- |
| `prospect_accounts` | Una por agencia: origen y clave de fila, campaña, SDR, prioridad, score, componentes y versión de puntaje (sin recalcular), zona, dirección, decisor, etapa, motivo de pérdida, próxima acción con fecha y precisión, notas de la planilla y del equipo, datos originales y `version` para concurrencia. |
| `prospect_contacts` | Varios por cuenta: canal, dirección normalizada y original, fuente, confianza, `needs_review` con motivo, `verified_at`, `invalid_at` con motivo, principal y decisor. |
| `outreach_templates` / `outreach_template_versions` | Plantilla por nombre, canal y paso. Las versiones son inmutables: un trigger rechaza `update`/`delete`. |
| `outreach_attempts` | Intento con UUID, `idempotency_key`, cuenta, contacto, campaña, paso (0 conversación, 1–3 secuencia), ordinal, versión o `is_custom`, texto y asunto congelados, canal, destinatario, emisor, estado, fechas, `lock_holder`/`lock_expires_at`, `version`, método de verificación, ID externo, evidencia y marca `legacy`. Un índice único permite un solo intento vivo (preparado, abierto o incierto) por cuenta. |
| `prospect_events` | Historial append-only (trigger). Las correcciones son eventos nuevos (`corrects_event_id`). Activación y primera compra son únicas por cuenta. |
| `prospect_suppressions` | Bajas por cuenta, canal o contacto, con motivo; se levantan con motivo y nunca se borran. |
| `prospect_imports` / `prospect_import_rows` | Cada importación con su mapeo, hash del archivo, reporte y resultado por fila. |
| `prospect_metric_settings` | Reglas de medición versionadas: 7 días para mensajes, 30 para cuentas y muestra pequeña si n<30. Es configuración, no datos. |

Todas las escrituras pasan por RPC transaccionales (`habita_prospect_*`), ejecutables solo por `service_role`, después de `requireAdmin`.

## 4. Aplicar y probar (local o staging, nunca producción con este cambio)

1. Usar un proyecto Supabase de staging, o uno local (`supabase start`), con las migraciones anteriores ya aplicadas.
2. Aplicar, en orden, `supabase/migrations/202611010001_prospecting.sql` y `supabase/migrations/202611020001_prospect_import_options.sql` en el SQL Editor o con `psql`. La segunda redefine la importación para aceptar contactos verificados por la planilla y el canal de los envíos históricos. Es aditiva e idempotente. No modifica tablas existentes, salvo que agrega filas a `agencies` al importar o al agregar cuentas.
3. Verificar:
   - `select habita_prospect_dataset();` devuelve listas vacías.
   - Como `authenticated`, `select * from prospect_accounts` da `permission denied`.
4. Variables de la app: las habituales (`SAAS_ENABLED=true`, Supabase y `ADMIN_EMAILS` con el email del operador). No hace falta ninguna variable nueva.
5. Ingresar con una cuenta del equipo y abrir `/admin/prospeccion`.
6. Probar en este orden:
   1. Importar `tests/fixtures/prospeccion-sintetica.csv` con el origen `fixture`. Debe dar 4 creadas, 2 filas rechazadas y 1 envío histórico.
   2. Reimportarlo: todas las filas deben quedar sin cambios.
   3. Crear una plantilla.
   4. Verificar un contacto y preparar el intento.
   5. Abrir el canal, con un número propio de prueba y nunca uno real de un prospecto.
   6. Confirmar el envío.
   7. Registrar una respuesta.
   8. Revisar el resumen y la vista de mensajes.

Sin Supabase, `npm test` ejecuta la migración real en PGlite.

## 5. Diccionario de métricas y atribución

Todas las cifras salen del mismo dataset persistido (`habita_prospect_dataset`) y de las mismas funciones (`src/lib/prospecting/metrics.ts`). El resumen y la vista de mensajes comparten filtros. Hora: America/Argentina/Buenos_Aires.

| Métrica | Definición |
| --- | --- |
| Prospectados | Cuentas en la base actual que cumplen los filtros de SDR, campaña y zona. No dependen de la cohorte. |
| Cohorte | Cuentas cuyo **primer envío confirmado** cae entre las fechas elegidas. Con filtro de canal, cuenta el primer envío por ese canal. |
| Enviados confirmados | Cuentas únicas de la cohorte con al menos un intento en estado `sent`. Preparar, abrir el chat o el mail, un envío fallido, un rebote, un número inválido o un envío cancelado no cuentan. «Mensajes confirmados» es un conteo aparte. |
| Respondieron (contacto efectivo) | Cuentas con una respuesta humana registrada a partir del primer envío. Excluye autorrespuestas, rebotes y respuestas corregidas. Una respuesta negativa cuenta; una baja sin respuesta no. |
| Interesados | Interés explícito registrado con fecha y evidencia obligatoria. Abrir una demo nunca cuenta como interés. |
| Activados | Primera ambientación hecha por un miembro de la inmobiliaria después de sumarse, completada y elegida como versión preferida (`approved_generation_id`) de una foto de esa inmobiliaria. Solo se mide en inmobiliarias con cuenta vinculada (creada por ellas o reclamada con código); las demás figuran como «Sin vincular». |
| Clientes | Primer pago de un miembro, posterior a sumarse, que el proveedor aprobó. Un reembolso o contracargo agrega un evento `refunded` y conserva la compra. Los pagos de compradores sin membresía nunca se adjudican a la inmobiliaria. |
| Ventanas | La cuenta se observa 30 días desde el primer envío y el mensaje, 7 días. Con precisión de día, la ventana corre desde el fin de ese día. Las tasas usan solo cuentas o envíos con ventana completa; los demás figuran «en observación». Los eventos fuera de ventana se guardan como tardíos. |
| Tasa de mensaje | Respuestas atribuidas sobre la base madura. La base son los envíos confirmados de esa campaña, paso, canal y versión, con ventana completa y sin una respuesta previa de la cuenta. |
| Atribución | Cada respuesta va al último envío confirmado anterior, dentro de la ventana; cada envío recibe como máximo una respuesta. Los toques anteriores desde la respuesta previa figuran como asistencias. Queda sin atribuir, conservando el resultado de cuenta, en tres casos: cronología ambigua (mismo día con un lado sin hora), respuesta tardía o respuesta sin envío previo. El interés se trata igual y se muestra como asociación, no como causa. |
| Por canal | Cuentas expuestas a cada canal, canal inicial, respuestas por último toque y asistencias. Las bases se superponen y no se suman; el total único está aparte. Muestra conteos sin tasa porque incluye recientes. |
| Variantes | Se comparan dentro del mismo paso, canal y campaña. «Muestra pequeña» si n<30. No hay ganadora automática ni prueba de significancia. Los mensajes personalizados y los históricos con variante desconocida tienen filas propias y quedan fuera de comparaciones; se informa la cobertura. |

**Cobertura del legado.** Un «Enviado» de la planilla con fecha se registra como intento `legacy`. Tiene precisión de día (00:00 hora Argentina), canal `unknown`, variante nula y paso 1 asumido. Cuenta para enviados de la cohorte. En mensajes aparece como «Sin atribuir (legado)». Una respuesta del mismo día queda sin atribuir.

## 6. Guía de operación (manual y por extensión de Claude Code)

La extensión opera la misma UI con la sesión del equipo. No hay endpoints sin autenticación ni integraciones nuevas. Selectores estables:

- `data-testid`: `tab-resumen`, `tab-prospectos`, `tab-mensajes`, `tab-ejecucion`, `queue-item`, `prepare-form`, `prepare-contact-select`, `prepare-template`, `prepare-body`, `prepare-reviewed`, `prepare-attempt`, `attempt-panel`, `attempt-status`, `open-channel`, `confirm-observed`, `confirm-send`, `mark-uncertain`, `mark-failed`, `mark-invalid`, `register-reply`, `event-form`, `sync-status`.
- `data-attempt-id` y `data-attempt-status`, en el panel y en la cola. Los nombres accesibles siguen el diseño: «Preparar intento», «Abrir WhatsApp», «Confirmar envío», «Registrar respuesta».

Flujo:

1. **Elegir la cuenta** desde la cola (Bandeja → Para preparar) o desde Prospectos → Ver ficha → «Preparar contacto».
2. **Preparar el intento.** Elegir el destinatario: solo se habilitan contactos con dirección, no inválidos, revisados y sin baja. Después elegir paso, versión y emisor, revisar el texto y marcar «Revisé destinatario…». El servidor congela el texto. Si el texto difiere de la versión renderizada, se guarda como personalizado. Una doble ejecución con la misma clave devuelve el mismo intento.
3. **Abrir el canal.** El servidor revisa otra vez las bajas y el contacto, y toma un bloqueo de 10 minutos para el operador. WhatsApp abre `wa.me`; email abre `mailto`. Abrir no es enviar ni prueba entrega.
4. **Enviar en el canal.** Lo hace el operador o la extensión, que debe detenerse ante un canal desconocido, una sesión vencida o un destinatario distinto del mostrado. Entre la apertura y el envío puede entrar una baja: el operador vuelve a comprobarlo.
5. **Confirmar.** Indicar el método (visto en el canal o manual), la hora, el ID externo y la evidencia opcionales, y marcar «Observé…». Confirmar dos veces registra un solo envío. Otro operador recibe `LOCKED`. «Confirmado por operador» no equivale a un recibo del proveedor.
6. **Si no salió:** usar «No se envió» (motivo obligatorio), «Número o email inválido» (invalida solo ese contacto) o «Cancelar».

**Resultado incierto.** Ocurre si el bloqueo vence sin confirmación o si el operador lo marca. El intento queda incierto e impide preparar otro para esa cuenta. Para conciliar, revisar el chat o la carpeta de enviados y elegir «Conciliar: se envió» o «Conciliar: no se envió». Nunca se reenvía solo. No existe garantía de envío exactamente una vez entre navegador y canal.

**Respuestas.** Se registran con «Registrar respuesta», indicando fecha (o solo día), canal y evidencia obligatoria. Una respuesta humana cancela los seguimientos preparados (pasos 1–3) y bloquea nuevos pasos de secuencia; después solo hay mensajes de conversación (paso 0). Perder la cuenta no borra la respuesta. Los errores se corrigen con «Corregir», que deja el original visible y marcado.

**Bajas.** Pueden ser de toda la cuenta, de un canal o de un contacto. Cancelan los intentos preparados y bloquean preparar y abrir. Un contacto alternativo no levanta una baja de cuenta. Levantar una baja requiere motivo y queda en el historial.

**Sincronización.** La vista recarga después de cada mutación, cada 60 segundos y al volver a la pestaña. La hora de la última actualización está visible; si una actualización falla, se avisa y se ofrece «Actualizar». Sin conector, nada se actualiza desde WhatsApp o Gmail.

## 7. Importador

- **Formato.** Acepta CSV o TSV de hasta 2 MB y 5000 filas, una pestaña por archivo. XLSX no se lee directamente: hay que exportar cada pestaña a CSV. No se agregó una dependencia para eso.
- **Mapeo.** Se detecta por encabezados y se puede editar. Las columnas sin mapear se listan y se guardan igual en `source_data`. La columna cortada en las capturas debe identificarse con el archivo real, sin suponer su contenido.
- **Clave de fila.** Es la columna ID si existe; si no, `nombre:<slug>`. Reimportar con el mismo origen actualiza la misma cuenta. Una importación aplicada dos veces con la misma clave devuelve su reporte.
- **Qué se actualiza al reimportar.** Se actualizan los campos de la planilla (score, componentes, notas, zona, datos originales) y el cambio queda en el historial con los valores anteriores. SDR y campaña solo se reemplazan si se marca la opción correspondiente. El historial, las próximas acciones y la etapa nunca se pisan.
- **Teléfonos.**
  - El enlace de WhatsApp se usa tal cual.
  - Un número de 10 dígitos recibe `+549` solo como candidato y queda «por revisar»: no se puede usar hasta verificarlo.
  - Los números sin 9, con formato desconocido o alternativos quedan por revisar.
  - «Número incorrecto» invalida ese contacto, no la cuenta.
- **Duplicados.** Mismo dominio, mismo WhatsApp o mismo email no genérico se marcan como «posible duplicado». Si coincide con una inmobiliaria existente (por nombre o dominio), se propone vincularla con una casilla. Nunca se fusiona automáticamente.
- **Contactos verificados.** Solo el texto exacto «WhatsApp verificado» en «Confianza del número» importa el contacto como verificado. Textos como «probable WhatsApp» o «por confirmar» quedan por revisar.
- **Varios emails en una celda.** Celdas como «a / b» o «a, b» generan un contacto por email; el primero queda como principal.
- **Mismo nombre con otra dirección.** Probablemente sea una sucursal: se importa aparte con clave `nombre:<slug>:dir:<slug de dirección>` y se marca para revisar.
- **Canal de los envíos históricos.** Lo indica el equipo al aplicar la importación: WhatsApp, email o desconocido. La variante siempre queda desconocida.
- **Errores.** Las filas sin nombre o con clave repetida se rechazan y figuran en el reporte. Un score no numérico, una fecha inválida o un «Enviado» sin fecha se informan; en esos casos no se inventa un valor ni un envío.

**Reporte con datos sintéticos.** Archivo: `tests/fixtures/prospeccion-sintetica.csv`, 6 filas.

| Resultado | Detalle |
| --- | --- |
| Filas creadas | 4 |
| Envíos históricos | 1, del 10/10/2026, sin hora y con canal desconocido |
| Filas rechazadas | 2: fila 6 sin nombre; fila 7 repite la fila 2 |
| Mensajes informados | Score «abc», fecha «sin fecha», número de 5 dígitos, 9 candidato y posible duplicado por dominio |
| Reimportación | Sin cambios y sin duplicados (cubierto por tests) |

**Vista previa de la planilla real** «Prospecting amobla IA», pestaña «Prospectos», 27/10/2026. Se hizo solo en local, sin escribir en ninguna base; el archivo quedó fuera del repo.

- **Filas:** 605, todas válidas. El mapeo automático reconoce 25 de 27 columnas. «Grupo Habita» y «Motivo / próximo paso» se conservan en los datos originales, por decisión del equipo.
- **Estados:**
  - 65 «Enviado» con fecha (23, 24 y 27/10). Se importan como envíos históricos por WhatsApp, con precisión de día y variante desconocida.
  - 539 «Pendiente».
  - 1 «Número incorrecto»: invalida su número, no la cuenta.
  - Dos filas tienen fecha sin estado «Enviado» y no generan envío.
- **WhatsApp:** 486 números de 10 dígitos. La planilla arma `wa.me/549` + número.
  - 42 entran verificados («WhatsApp verificado»).
  - 444 quedan por revisar.
  - 1 queda inválido.
- **Emails:** 606, después de separar 48 celdas con varios. Uno está mal escrito en la planilla (dominio cortado) y queda por revisar.
- **Posibles duplicados para revisar:**
  - 3 por mismo dominio web y 1 por mismo email.
  - «Depaoli Propiedades» aparece dos veces con direcciones distintas; se importa como dos cuentas.
- **Contactos:** 56 cuentas quedan sin un contacto de WhatsApp o email usable sin revisión previa.

**Importación real.** No se aplicó: se hace desde Prospectos → Importar planilla, con las migraciones ya aplicadas. Hay que exportar la pestaña «Prospectos» a CSV y elegir el canal «WhatsApp» para los envíos históricos. El archivo contiene contactos comerciales y debe quedar fuera de Git.

## 8. Validación realizada

- `npm run lint`, `npm run typecheck`, `npm test` (56 archivos, 481 tests) y `npm run build` aprobados. Las pruebas nuevas cubren:
  - Idempotencia de preparación, confirmación, registros e importación.
  - Un solo intento vivo por cuenta, bloqueo de otro operador, versión vieja y bloqueo vencido que pasa a incierto.
  - Bajas por cuenta y por canal, y baja después de abrir el canal.
  - Detención de la secuencia, respuesta conservada tras perder la cuenta, historial append-only y correcciones.
  - Versiones inmutables y mensajes personalizados.
  - Score versionado y reimportación.
  - Activación y compra: solo miembros, después de sumarse, con reembolso conservado.
  - Privacidad para `anon` y `authenticated`.
  - Atribución, ventanas, superposición de canales, v2 → v3, ambigüedad por precisión de día y «Para hoy».
  - 401/403 y origen ajeno en todas las rutas; validaciones.
- **Recorrido real de la UI** con Playwright, `next dev` y un sustituto local de Supabase (auth y RPC) sobre PGlite con estas migraciones. Se recorrieron: estado vacío, importación del CSV sintético con vista previa y reporte, plantilla, verificación de contacto, preparar desde la ficha (selecciona esa cuenta), abrir el canal (el enlace externo bloqueado), confirmar y una segunda confirmación por API, respuesta, bloqueo vencido que pasa a incierto, resumen con filtro de SDR, mensajes, «Para hoy», navegación con flechas entre pestañas y móvil de 390 px.
  - Confirmado: abrir el canal no cambió el conteo de enviados; la segunda confirmación devolvió `replayed` y hay un solo evento `sent`.
  - Sin errores de página y sin desbordamiento horizontal en móvil.
  - No se usó Supabase real, ningún proveedor ni producción.
- Capturas en `docs/prospeccion/`.

## 9. Pendientes concretos

1. Aplicar la migración en staging y repetir la prueba del §4.6 con Supabase real y una cuenta del equipo.
2. Conseguir el CSV real por pestaña e identificar la columna cortada. Hacer la vista previa en staging y revisar coincidencias y duplicados antes de aplicar. Importar a producción solo con autorización.
3. Validar la normalización de teléfonos con los números reales (zona de Mar del Plata y Miramar). Verificar a mano los candidatos con 9 agregado.
4. Definir la versión de puntaje de la planilla (las reglas no están documentadas) y cargarla en `scoring_version`.
5. Activación: hoy se basa en la «versión preferida». Si se quiere una aprobación explícita de la primera foto propia, hace falta un evento de aprobación en el editor de la inmobiliaria.
6. Si se necesita lectura automática de respuestas, hace falta un conector verificable de WhatsApp o Gmail, que no forma parte de este cambio.
7. Probar el flujo con la extensión de Claude Code en staging, con un número de prueba propio.
