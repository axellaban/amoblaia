# Edición administrativa, editor por foto y altas — 27 de octubre de 2026

Rama `claude/admiring-faraday-p44fxt`, sobre `main` `02a736d` (incluye #29–#32; `main` no cambió después de la revisión). Diseño de referencia: rama `design/usabilidad-panel-v3`, carpeta `docs/prototipos/usabilidad-v3/`. Las imágenes y cifras de la maqueta no se incorporaron como datos.

**No se desplegó ni se aplicó ninguna migración en producción.** Tampoco se generaron imágenes, se acreditó saldo ni se enviaron invitaciones o mensajes.

## 1. Qué cambió

| Pedido | Implementación |
| --- | --- |
| Acceso de edición del administrador | `/admin/inmobiliarias/<id>/editar` (propiedades, datos y marca, créditos, actividad) y `/admin/inmobiliarias/<id>/propiedades/<demo>` (editor compartido). «Ver como cliente» queda igual: soporte de solo lectura. |
| Administración más simple | Cada fila tiene una acción principal, **Editar inmobiliaria**; tres secundarias (Ver propiedades, Agregar propiedad, Créditos) y **Ver como cliente** como enlace discreto. Búsqueda, página y fila abierta quedan en la URL y se recuperan al volver (con scroll a la fila). Cada propiedad muestra una sola próxima acción. |
| Editor de fotos | Espacios a la izquierda, foto o versión activa en el centro, versiones y acciones a la derecha. En móvil se apilan sin scroll horizontal. |
| Descarga | **Descargar esta versión** pide exactamente esa versión por su `generation_id` (JPEG de hasta 2048 px, el mismo endpoint de siempre). El nombre es `propiedad-espacio-estilo-vN.jpg`. No usa créditos, no exige saldo ni publicar, y no se bloquea porque otra foto se esté generando. |
| Crear otra versión | Un selector con acción soportada (Amoblar o Rediseñar) y estilo compatible. El ambiente sale del tipo de espacio y, si choca con el ajuste propio de la foto, se pregunta. Muestra cotización y cuenta pagadora antes de iniciar. Cancelar o un rechazo conservan lo elegido. |
| Trabajo masivo | «Seleccionar fotos para una tanda» abre el lote existente: estilos, fotos por espacio, faltantes, cotización del servidor y mover las elegidas a un espacio. Usa una sola cola para lo individual y lo masivo. |
| Agregar propiedad | La inmobiliaria viene fija. Se elige entre «Pegar enlace» y «Cargar a mano», nunca los dos a la vez, en tres pasos. El enlace reutiliza la importación del panel (clave idempotente, snapshot, recuperación parcial). A mano es un borrador idempotente. |
| Crear inmobiliaria | `/admin/inmobiliarias/nueva`: solo el nombre comercial es obligatorio. Detecta posibles duplicados y nunca los fusiona. Después ofrece «Agregar primera propiedad» o «Continuar más tarde». No crea cuenta, invitación ni saldo. |

## 2. Autorización

**Contexto de edición.** Al entrar a «Editar inmobiliaria», el servidor firma un token (HMAC) que identifica al miembro del equipo, la inmobiliaria y el vencimiento (4 horas): `POST /api/admin/inmobiliarias/<id>/edicion`. Se audita antes de entregarlo. Cada pestaña lo guarda en su `sessionStorage`, por inmobiliaria, y lo envía en el header `x-habita-edicion` en cada llamada a la API de administración.

- `requireDemoAccess` valida el token del actor y rechaza con **409** si la inmobiliaria del token no es la dueña del recurso. Por eso dos pestañas en dos inmobiliarias no se cruzan.
- Un token vencido o inválido devuelve **412**. Arriba se ofrece «Renovar edición» y los borradores en pantalla no se pierden.
- Una cuenta que no es del equipo y manda el header recibe **403**.
- Las escrituras a nivel inmobiliaria (datos, marca, logo, alta manual, importación) exigen el contexto de esa inmobiliaria (`requireAgencyEdit`).
- No hay cookie compartida, suplantación ni cambio de sesión. No se usa Referer ni ningún atributo del navegador para conceder permisos. `assertReadable` y la vista de soporte siguen como estaban.

**Qué permite y qué no.** El detalle está en `src/lib/agency/edit-scope.ts` y se muestra en el aviso.

- Incluido: datos y notas internas, marca y canal de consultas, crear y editar propiedades, fotos, espacios y versiones, y publicar o despublicar con confirmación de impacto.
- Queda aparte: compras, cuenta, email y contraseña del dueño, y créditos de regalo (tienen su propio flujo, con motivo e idempotencia).
- Generar con créditos del cliente: `stagingRule` lo sigue bloqueando para el equipo. El selector lo explica y la edición sigue habilitada. En inmobiliarias sin cuenta, el equipo genera como demo, sin usar créditos del cliente.

**Auditoría.** Cada mutación administrativa sobre una inmobiliaria escribe en `admin_audit` una fila `agency_edit` con actor, `subject_id` = inmobiliaria, `operation` y propiedad, y `via` (`edit_context` o `admin_demo` para las páginas viejas de Demos). También se registran `agency_edit_start/renew/end` y `agency_create`. Se ve en la pestaña «Actividad del equipo».

**Aislamiento.** `contact_email` queda fuera del permiso por columnas de los miembros, igual que `notes` y `contact_name` (probado con RLS en PGlite).

## 3. Migración `202611010001_admin_editing.sql` (aditiva e idempotente)

- `agencies.contact_email` (privado) y `agencies.request_key`, con índice único parcial.
- `demo_properties.request_key`, con índice único parcial por inmobiliaria.
- Índice `admin_audit(subject_id, created_at desc)`.

Pasos en local o staging (no en producción sin aprobación):

1. Supabase de staging → SQL Editor → pegar y ejecutar el archivo. Se puede volver a ejecutar sin problema.
2. Comprobar que `select contact_email, request_key from agencies limit 1;` responde y que `admin_audit_subject` existe.
3. Con la cuenta del equipo (`ADMIN_EMAILS`), en `/admin/inmobiliarias`:
   1. Crear una inmobiliaria de prueba.
   2. Entrar a «Editar inmobiliaria» y agregar una propiedad a mano.
   3. Abrir el editor, organizar las fotos y descargar una versión.
   4. Revisar «Actividad del equipo».

Sin la migración, lo existente sigue funcionando. El email de contacto aparece deshabilitado, y el alta independiente y el alta manual responden con un mensaje que pide aplicarla.

## 4. Guía breve

**Para el equipo (administración)**
- **Editar inmobiliaria** abre su espacio de trabajo: actuás con tu usuario, el aviso verde dice qué inmobiliaria estás editando y hasta cuándo, y todo queda registrado. «Salir de esta inmobiliaria» cierra la edición y vuelve a la lista como estaba.
- **Ver como cliente** es solo para soporte: muestra su panel en solo lectura durante una hora.
- En cada propiedad, el botón principal es la próxima acción («Continuar con las fotos», «Revisar y publicar»…).
- En el editor:
  - Elegir una versión solo cambia lo que ves.
  - «Mostrar esta en la ficha», «Usar de portada», «Se muestra / Oculta» y publicar son botones separados.
  - **Descargar esta versión** baja la versión que estás viendo.
  - **Crear otra versión** revisa el costo y quién paga antes de empezar.
- **Nueva inmobiliaria** crea solo la ficha. Invitar, crear la cuenta del cliente y regalar créditos se hacen aparte.

**Para la inmobiliaria (panel)**
- El editor por foto es el mismo: elegir, comparar, descargar sin costo y crear versiones con cotización previa. Generar usa los créditos de la inmobiliaria, una vez por foto, como antes.
- Publicar y despublicar ahora piden confirmación y explican el impacto.
- La importación desde enlace no cambió.

## 5. Verificación realizada

- `npm run lint`, `npm run typecheck`, `npm test` (54 archivos, **444 pruebas**; antes 52 y 404) y `npm run build`: todo en verde.
- Pruebas nuevas:
  - `tests/admin-editing.test.ts`: contexto firmado, 403/409/412, cruce de pestañas, soporte de solo lectura, auditoría, créditos no habilitados por editar, alta independiente sin efectos colaterales, idempotencia, duplicados, alta contextual, importación parcial y su recuperación, actividad.
  - `tests/photo-workspace-logic.test.ts`: vista, versiones, estados (incluido «incierto»), lote, ambiente, descarga, duplicados, próxima acción.
  - `tests/agency-database.test.ts`: migración en PGlite, RLS y unicidad.
  - `tests/demo-download.test.ts`: descarga del original.
- **UI en Chromium (Playwright)**: los componentes reales, con la API interceptada y datos ilustrativos (fotos de `public/ejemplos`), en 1440 px y 390 px. Pasaron 24 comprobaciones; entre ellas:
  - Elegir una versión no hace ninguna llamada de escritura.
  - La descarga pide la versión activa por su id.
  - Cancelar conserva estilo y acción.
  - El conflicto de ambiente se señala.
  - No hay scroll horizontal en móvil.
  - Se ve un solo formulario de alta.
  - Los duplicados aparecen antes de crear.

  Las capturas están en `docs/verificacion/usabilidad-v3/`.
- Se corrigió un fallo previo: Chromium guardaba como «download» los archivos con acentos en el nombre. Ahora se usa el nombre ASCII con guiones.

## 6. Límites y validaciones externas pendientes

- Falta probar con Supabase real (staging) y una sesión de equipo verdadera: las rutas y la base se probaron con dobles en memoria y PGlite, no contra PostgREST.
- La vista por foto se verificó con la API simulada. Falta un recorrido completo con generación real (OpenAI) en staging.
- Una regeneración pasa a mostrarse en la ficha cuando termina, salvo que se haya elegido otra versión del estilo. El modelo guarda una sola versión «aprobada» por foto. El selector lo avisa antes de confirmar. Fijar una versión por estilo requeriría un cambio de esquema.
- La cola de versiones aún no enviadas vive en la pestaña. Si se cierra, solo sigue la que ya está en el servidor, y el lote lo dice.
- El panel de la inmobiliaria conserva su importación por enlace. La carga a mano con pasos se agregó solo al flujo administrativo.
- Las páginas viejas `/admin/demos/<id>` y `/admin/demos/nueva` siguen funcionando, sin contexto de edición. Sus cambios quedan auditados con `via: admin_demo`.

## 7. Integración con Prospección (`design/prospeccion-entrega`)

Hoy solo existe la rama de diseño (documentos y capturas, basada en #28). No hay implementación publicada ni PR. Este trabajo **no** hace merge con esa rama. Puntos de contacto:

- **Inmobiliarias**: prospección debe colgar `prospect_accounts.agency_id` de `agencies`, como ya se hace aquí. No se creó ningún modelo paralelo.
- **Altas**: `createAgencyRecord` y `possibleDuplicates`/`findDuplicates` (`src/lib/agency/admin-edit.ts`, `duplicates.ts`) sirven para crear cuentas desde la planilla. Tienen clave idempotente y detectan duplicados por nombre, sitio o email sin fusionar, igual que pide su especificación.
- **Contactos**: `agencies.contact_name` y `contact_email` son el contacto interno básico. Los contactos comerciales múltiples de prospección (`prospect_contacts`) deben vivir en sus propias tablas, sin reutilizar estas columnas.
- **Navegación**: `ADMIN_SECTIONS` en `src/components/admin-nav.tsx`. Agregar «Prospección» es una línea.
- **Auditoría**: `admin_audit` con `subject_id` = inmobiliaria y el índice nuevo. Los eventos de prospección deben ir a su tabla `prospect_events`, no a esta.
- **Migraciones**: `202611010001` solo agrega columnas e índices, y no toca tablas que prospección vaya a crear. Al integrar, ordenar por nombre y volver a correr `tests/agency-database.test.ts` con ambas.

Antes de integrar: `git diff` entre ambas ramas sobre `src/lib/agency/*`, `src/app/admin/inmobiliarias/*` y `src/app/globals.css`, y ejecutar lint, typecheck, test y build sobre el resultado combinado.
