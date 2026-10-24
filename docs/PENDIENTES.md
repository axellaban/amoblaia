# Estado de entrega y pendientes — 20 de octubre de 2026

Se detiene el trabajo a pedido del usuario para conservar créditos. Los cambios funcionales ya están en `main`, publicados hasta `2b4ae45` (`Reserve persistent batches and render proposals independently in parallel`). No hay una rama de funcionalidades pendiente de merge. Esta nota no certifica que el producto esté listo para vender sin restricciones.

Producción: https://amoblaia.vercel.app/

## Estado actual, propuestas y fichas compartibles — 24 de octubre de 2026

- **Pendiente: aplicar en Supabase `202610240001_property_showcases.sql`** (SQL Editor; se puede re-ejecutar) antes de publicar la rama `claude/fichas-estado-actual`. Sin ella el estudio y la biblioteca funcionan como antes, pero la revisión, `/fichas`, `/ficha/…` y `/embed/…` no.
- Opcional: `EMBED_FRAME_ANCESTORS` para limitar qué sitios pueden insertar fichas.
- Falta probar con Supabase real y con generaciones reales los prompts nuevos de Amoblar/Rediseñar. Detalle, cómo probar y límites: [FICHAS.md](FICHAS.md).

## Cuentas ilimitadas y varias fotos por tanda — 23 de octubre de 2026

- `UNLIMITED_EMAILS` (Vercel, separada por comas) marca cuentas del equipo que generan sin descontar fotos. Al entrar, la app les abre una asignación de 1.000.000 de fotos sin vencimiento (`credit_grants.source_key = unlimited:<id>`) y les sube el cupo diario a 1000. Si un email sale de la lista, esa asignación vence en su próximo ingreso. No requiere migración. Siguen valiendo el espacio por cuenta (320 MB) y el máximo de 150 fotos guardadas.
- Las cuentas con fotos pagas (suscripción o pack) pueden arrastrar hasta 20 fotos juntas en el estudio, elegir el ambiente de cada una y crear un diseño de cada foto con el mismo estilo. Se envían de a una porque la base admite una tanda en curso por cuenta. Procesarlas en paralelo requiere cambiar `amobla_reserve_generation` y revisar el límite de imágenes por minuto de OpenAI.
- Límites con tandas de 20, revisados sin generar imágenes reales:
  - Peso: cada foto queda muy por debajo de los topes (2,8 MB al subir, 3 MB en el servidor, 4 MB por archivo en Storage). Entre original y resultado ocupa unos 0,6–2,5 MB, así que una tanda de 20 usa unos 12–50 MB del presupuesto global de 800 MB y del de 320 MB por cuenta.
  - Cupo diario: con `MAX_GENERATIONS_PER_DAY=100` cada cuenta puede crear 33 diseños por día y entre todas 100. Una tanda de 20 entra; una segunda el mismo día se frena en la foto 14 y las demás quedan en espera para retomarlas al día siguiente. Subir el valor en Vercel (por ejemplo a 300: 100 por cuenta) es una decisión de costo.
  - Duración: las fotos van de a una, así que 20 tardan bastante más que una sola. La página mantiene la pantalla encendida mientras procesa (Wake Lock, donde el navegador lo permite) y avisa antes de cerrarse.

## Auditoría de cobros — 23 de octubre de 2026

- **Pendiente: aplicar en Supabase `202610230002_billing_audit.sql`** (SQL Editor; se puede re-ejecutar). Sin ella el código publicado funciona como antes, pero quedan apagados la devolución automática de duplicados, la reutilización del checkout del pack y la vuelta al precio de lista con su barrido diario. Verificar después que `amobla_apply_payment` devuelva `text` y que `subscriptions` tenga `list_price_restored_at` y `list_price_checked_at`.
- Caso real: el plan Agente de un cliente se reembolsó completo y la suscripción siguió activa en Mercado Pago, con un cobro programado para el 21/11. El reembolso quitó las fotos, pero no canceló la suscripción. La causa probable es que se procesó antes del deploy que agregó esa regla, aunque no está confirmado. El titular la canceló a mano. El barrido diario ahora cancela esos casos.
- Reglas nuevas de reembolso:
  - Un contracargo, o el reembolso del último cobro, termina el plan y devuelve el período cobrado.
  - El reembolso de un cobro anterior no termina el plan.
  - El reembolso de uno de dos cobros de la misma renovación (a menos de 15 días) conserva el plan: el otro cobro hereda ese mes y las fotos ya usadas, sin bloquear la cuenta.
  - Un plan anual con reembolso parcial sigue dando sus fotos mensuales.
- Pack de una compra por cuenta:
  - Un segundo checkout reutiliza el que está abierto.
  - Un segundo pago queda `duplicate`: se cierra su orden y la app lo devuelve.
  - Si Mercado Pago rechaza esa devolución (400/404/422), el pago queda `duplicate` para hacerlo a mano.
  - Cuando el dinero vuelve, por reembolso o contracargo, el pago pasa a `duplicate_refunded`.
- Notificaciones:
  - Un pago rechazado sin factura ya no se reintenta.
  - Una factura `subscription_authorized_payment` que sigue en 404 a los 3 días se cierra como `ABANDONED_MERCADOPAGO_404` después de un último intento.
  - Esto limpia los avisos trabados del intento rechazado del 22/10.
- `202610230001_launch_pricing.sql` solo escribe el catálogo en su primera ejecución. Si se re-ejecuta, hay que re-ejecutar después `202610230002`.
- Verificación: 211 tests, TypeScript y ESLint aprobados. No se probó contra Mercado Pago real: la devolución automática y las cancelaciones quedan por confirmar con el primer caso real.
- Pendiente del titular en Mercado Pago:
  - El checkout muestra «HolaVeggie», que es el nombre de la cuenta vendedora. Hay que renombrarla o usar una cuenta propia para amoblaIA.
  - Descartar su propio checkout pendiente del plan Inicial a $20.000, de un precio que ya no existe.

## Checkout alojado — 22 de octubre de 2026

- Se reemplaza el formulario de tarjeta por el checkout alojado de Mercado Pago: Suscripciones para mensual/anual, Checkout Pro para packs. Los precios y la renovación se conservan. El email de pago de suscripciones sigue siendo explícito.
- El retorno comprueba propiedad de la orden, consulta al proveedor y acredita mediante el mismo RPC idempotente que los webhooks. Los parámetros de éxito del navegador no habilitan créditos. Mi cuenta permite retomar/verificar compras abiertas.
- El plan anterior se conserva al abrir o autorizar un cambio; su renovación se cancela después de verificar el primer cobro aprobado del nuevo. La relación de reemplazo se guarda en la transacción que crea la orden.
- Aplicadas en Supabase las migraciones `202610210003_billing_hardening.sql` (faltaba el contador de fallos) y `202610220001_hosted_checkout.sql`. No se contrataron recursos pagos.
- Recuperación de 404 de facturas mediante búsqueda por ID exacto, conservación de errores realmente pendientes y protección frente a reenvíos de eventos procesados. El cron incorpora conciliación de compras recientes y renovaciones próximas.
- Verificación automatizada: 181 tests en 32 archivos aprobados antes de la revisión visual. Falta una compra aprobada que complete el titular: no se reenvía su tarjeta ni se realiza un cobro para certificarla.
- Detalle de alcance y validación: [CHECKOUT_ALOJADO_2026-10-22.md](CHECKOUT_ALOJADO_2026-10-22.md).

## Corrección de checkout — 22 de octubre de 2026

- **Diagnóstico comprobado del intento de las 19:55, referencia `4299340e`:** el comprador confirmó un email distinto del login y pasó el control previo. Mercado Pago rechazó `POST /preapproval` con HTTP 400 y `CC_VAL_433 Credit card validation has failed`. El detalle oficial de la operación en su panel dice explícitamente «El banco emisor de la tarjeta rechazó el pago», por ARS 20.000, sin un motivo bancario más específico. La orden quedó en `checkout_failed`, sin suscripción asociada ni pagos registrados para esa orden. La revisión fue de solo lectura: no se reintentó el cobro. No atribuir este rechazo a país del email, saldo, CVV u otra causa no informada por el proveedor.
- **Pendiente separado de webhooks:** después de ese rechazo llegaron notificaciones `subscription_authorized_payment` cuyo recurso devuelve 404 al consultar `/authorized_payments/{id}`. El receptor conserva el error `MERCADOPAGO_404` y responde 500 para permitir reintentos. Investigar y reconciliar esos avisos con la información oficial del proveedor; no ignorarlos como procesados ni acreditar créditos sin verificar un pago aprobado. Este problema posterior no causó el rechazo de `/preapproval` y no certifica el circuito de pagos aprobados.
- **Diagnóstico comprobado del intento de las 19:20, referencia `6b157b23`:** la API autenticada `/users/me` devuelve vendedor `MLA` / `AR`, cuenta real y collector ID coincidente con Vercel. El email guardado en ese intento coincide tanto con el login como con el email del vendedor. No se creó una suscripción. El usuario no lo escribió; el campo del SDK tenía un valor, compatible con autocompletado/restauración del navegador. No se determinó qué mecanismo concreto lo completó.
- La interpretación anterior de `guest_site_mismatch` como prueba de que el email era de otro país **no estaba demostrada**. Se retiraron esa afirmación y la instrucción de cambiar de país. Ese código por sí solo no prueba un problema con la tarjeta ni permite atribuirle el error al comprador.
- El checkout exige confirmar un campo de email visible antes de inicializar Card Payment Brick. La confirmación consulta la identidad real del vendedor y rechaza el email de la cuenta cobradora antes de pedir tarjeta, crear órdenes, cancelar suscripciones o hacer un cobro. El POST final repite el control en el servidor para que no dependa del navegador. Cambiar el email desmonta el formulario anterior y requiere una nueva confirmación.
- El email confirmado se pasa al SDK y se compara con el que devuelve su tokenización. No se sustituye por el login ni por un email de prueba configurado. El usuario autenticado continúa siendo el dueño de la orden.
- Se agregó diagnóstico de solo lectura en `/api/admin/billing`, reservado a administradores y sin emails, credenciales ni datos de tarjeta en la respuesta. Devuelve únicamente configuración y banderas de comparación. Las credenciales privadas no se copiaron ni se cambiaron.
- Las pruebas específicas cubren comprador/vendedor diferentes, autocobro bloqueado, configuración argentina, collector incorrecto, error de identidad, confirmación sin órdenes ni cargos y privacidad del diagnóstico. Sigue pendiente una compra real con comprador y medio de pago distintos del vendedor y su acreditación por webhook. No confundir el control previo con la certificación del circuito completo.
- Verificación automatizada de esta revisión: 167 tests en 28 archivos aprobados; TypeScript, ESLint y build correctos.
- Verificación real en producción de `7dcb73d`: email vacío bloqueado por el formulario sin error de país ni campos de tarjeta; en móvil de 390 px el campo queda visible y sin desbordamiento horizontal. Con el email exacto del intento reportado, el control previo devuelve «El email para el pago corresponde a la cuenta que cobra…», sin inicializar campos de tarjeta. Con un email diferente, el control previo permite cargar el formulario real del SDK; no se completaron datos de tarjeta. La última orden sigue siendo `6b157b23` de las 19:20: ninguna de las dos comprobaciones creó otra orden. Capturas en `outputs/verificacion/checkout-confirmacion-previa-{desktop,mobile}.png`, fuera del repositorio.
- Referencias: [contrato del Brick](https://github.com/mercadopago/sdk-js/blob/main/docs/bricks/card-payment.md) y [pruebas con identidades compradora y vendedora diferentes](https://www.mercadopago.com.ar/developers/es/docs/checkout-bricks/integration-test/test-payment-flow).

## Actualización 21 de octubre de 2026 (rama `claude/gracious-volta-oavmeb`)

- **Crédito de OpenAI agotado** durante la generación de ejemplos (`credit_balance_exhausted`). Si es la misma clave que usa producción, la generación de imágenes de los clientes también falla hasta recargar crédito.
- Google: se agregó acceso por redirección en la misma pestaña (Supabase OAuth, ya registrado en Google) como alternativa visible y como reemplazo si el script de Google no carga. Falta probarlo con una cuenta real. Para que Google muestre el dominio de amoblaIA en lugar de `cmpfwuycxdleunuumlkm.supabase.co` habría que registrar una URI propia en Google Cloud.
- Home y pie de página rehechos sobre la referencia, con traducción fiel y datos propios (minutos, 10 estilos, precios en pesos). Se omitieron las citas de prensa y las redes sociales de la referencia porque amoblaIA no las tiene.
- Ejemplos: 79 escenas para 8 ambientes y 10 estilos. Faltan Clásico y Estándar en comedor, cocina, home office, patio, monoambiente y quincho (Estándar en comedor también); se generan con `scripts/generate-examples.ts` al recargar crédito. Falta también la foto propia de personas del bloque final; hoy usa un living de ejemplo.
- Cierre de sesión con alcance local y modal de email de pago con Escape y foco: hechos.
- Puntos 4 y 5 de «Siguiente pasada técnica» resueltos: un rechazo de tanda ya no deja proyecto ni original, y los originales duplicados del invitado se borran al convertir. **Aplicar en Supabase la migración `202610210001_claim_guest_orphans.sql`** (SQL Editor); hasta entonces la app funciona como antes y no borra esos originales.
- Migración `202610210001_claim_guest_orphans.sql` aplicada en Supabase y verificada (devuelve `text[]`, solo `service_role` puede ejecutarla).
- Con crédito recargado: completas las 88 escenas de ejemplo (8 ambientes × 10 estilos + vacías) y la foto propia del bloque final.
- Evaluación visual de modos pagos con el prompt y los parámetros de producción, sobre ocho casos: Mejorar foto (living, quincho) cambia exposición y color sin alterar el ambiente; Día a atardecer (terraza vacía y living amoblado) da un atardecer creíble y enciende solo las luces existentes; Vaciar (dormitorio y home office) deja el ambiente vacío y conserva aberturas y placard, aunque en el home office dejó una estantería exenta; Rediseñar living a Industrial y Amoblar monoambiente Minimalista respetan la arquitectura. No reemplaza una prueba con fotos reales de clientes.
- Siguen pendientes los puntos 1, 6 y 8: requieren sesión real o servicios externos. Para el punto 1 hay un prompt de prueba para la extensión de navegador.

## Prioridad inmediata: bloqueos para el lanzamiento

### 1. El botón de Google no inicia el acceso

**Abierto y reportado por el usuario:** en `/acceso?next=%2Festudio`, al pulsar «Continuar con Google» no sucede nada. El botón carga, pero no aparece selector de cuenta, redirección ni error. Se reprodujo un clic sin efecto en una pestaña de Chrome en segundo plano; eso no determina la causa del problema en el navegador activo del usuario.

La implementación actual está en `src/components/google-signin.tsx`: Google Identity Services, botón con FedCM, popup, nonce aleatorio y canje del ID token por sesión de Supabase. Se comprobó que el origen de producción está autorizado en Google. **No hay una corrección adicional ni un fallback por redirección implementados.** La interacción entre FedCM, pestaña activa y navegador integrado es una hipótesis, no un diagnóstico confirmado.

Próxima tarea: reproducir en Chrome activo y en el navegador integrado, corregir el inicio de sesión y ofrecer una alternativa cuando no abra el selector. Mantener una experiencia con el dominio de amoblaIA y comprobar cancelación, errores y regreso a la ruta solicitada en móvil y escritorio.

### 2. Mercado Pago necesita una prueba completa con comprador

Se implementó la captura explícita del email de Mercado Pago, sin asumir que coincide con el de Google. Los tests cubren normalización, reutilización de pendientes y sustitución de un alta pendiente al corregir el email, sin cancelar automáticamente una suscripción autorizada.

**Todavía no se completó una compra real ni se certificó el circuito de cobro y acreditación.** Probar con una cuenta compradora distinta de la vendedora: pago aprobado, rechazado y pendiente; reintento; webhook y duplicados; acreditación una sola vez; renovación, cancelación y reembolso. Una prueba que cobre dinero requiere acordar importe y que el usuario complete la confirmación de pago.

### 3. Comprobar el traspaso de la prueba anónima a Google

La transferencia de proyectos, resultados y consumo tiene pruebas SQL y automatizadas, pero falta verificarla de punta a punta con la cuenta real porque el botón de Google bloquea este paso. No presentar esa validación como realizada.

En el navegador de prueba quedaron seis resultados anónimos y 19 de 25 disponibles. Al transferirlos a una cuenta que ya consumió gratuitos, se debe sumar el consumo anterior, sin reiniciar el cupo. Comprobar también originales duplicados y cierre de la sesión invitada.

## Lo implementado y verificado

- Prueba sin registro ni tarjeta: hasta 25 resultados, en tandas de hasta tres; la última tanda se ajusta a dos o uno. El texto principal es «Sin registrarte · Sin tarjeta de crédito».
- Reserva persistente y atómica de la tanda, con trabajos en paralelo e idempotencia; cada imagen aparece y se puede descargar cuando termina. Las otras miniaturas mantienen su indicador de carga.
- Prueba real en producción: primera imagen visible y descargable con otras dos pendientes. Otra tanda de tres terminó correctamente; los tres trabajos comenzaron con una diferencia de 0,227 segundos. Una recarga durante el proceso recuperó el original y los seis resultados acumulados, sin errores y con el cupo correcto.
- Borrador en IndexedDB: archivo original, ambiente, estilo, operación, notas y consentimiento; vigencia de 24 horas.
- Tres composiciones diferenciadas por tanda, conservando la instrucción de respetar arquitectura y estilo. Se revisaron tres resultados reales del mismo ambiente; esto no certifica calidad para todas las fotos o estilos.
- Diez estilos habituales, sin ofrecer «Ecléctico» como categoría: Estándar, Moderno, Nórdico, Industrial, Mid-century, Lujo, Costero, Rústico, Minimalista y Clásico.
- Tour de nueve pasos, omisión y repetición; recorrido móvil completado y finalización persistida en la cuenta.
- Retirados el nombre personal y CUIT de los textos públicos.
- 83 pruebas automatizadas en 16 archivos aprobadas. TypeScript y ESLint aprobados; despliegue de producción del último commit funcional completado. Los tests se ejecutan con `--maxWorkers=2` para evitar saturación local de PGlite.
- Navegación de 19 rutas públicas en escritorio (1452 px) y móvil (390 px), sin desbordamiento horizontal ni imágenes rotas en esa inspección. Esto no equivale a probar todos los escenarios privados.
- Controles HTTP en producción: solicitudes sin autorización a proyectos, trabajos, checkout y administración rechazadas; webhook sin firma y origen ajeno rechazados.

## Base de datos y configuración al detenerse

- Supabase continúa en el plan Free; no se contrató un plan pago. Están aplicadas las migraciones hasta `202610200012_generation_batches.sql`, incluidas sesión anónima, consumo por origen y reserva de tandas.
- Acceso anónimo habilitado. La confirmación de email para cuentas con email continúa habilitada.
- La cuota compartida por origen y la del usuario se controlan en el servidor. Hay límites de capacidad diaria y presupuesto de almacenamiento; revisar su adecuación antes de aumentar tráfico.
- Ocho precios de suscripción activos en ARS: mensuales 20.000 / 27.000 / 60.000 / 105.000; anuales 150.000 / 180.000 / 360.000 / 720.000 como cobro anual completo. Packs de 10 y 25 inactivos.
- Configuración y migraciones detalladas en `COMMERCE_SETUP.md`. Las credenciales permanecen en los archivos ignorados y servicios correspondientes; no copiarlas a esta documentación.
- El plan gratuito de base de datos no elimina el costo de la API de imágenes.

## Siguiente pasada técnica

1. Probar en la interfaz la biblioteca privada: crear/renombrar carpetas, mover fotos, papelera, restauración y eliminación. Hay pruebas de aislamiento SQL; la última comprobación manual quedó interrumpida por una sesión vencida.
2. Revisar cierre de sesión: las llamadas actuales usan `signOut()` con alcance global por defecto. Evaluar `{ scope: "local" }` para que el cierre ordinario no afecte otros navegadores.
3. Agregar Escape y gestión de foco al modal del email de pago. Cerrar con botón/fondo y validación de email requerido ya se comprobaron.
4. Revisar `enqueuePhoto`: se sube el original antes de que el RPC rechace por cupo o tanda activa. Evitar originales innecesarios en rechazos y coordinarlo con idempotencia y límites de capacidad.
5. Revisar limpieza de archivos huérfanos al fusionar originales duplicados durante la conversión de invitado; el proyecto antiguo puede quedar eliminado lógicamente con su blob original.
6. Ampliar pruebas reales de fallas parciales, revisión de imágenes, sesión interrumpida y enlaces firmados vencidos. Confirmar siempre que una falla no borra resultados de otros trabajos y que el cupo se restaura cuando corresponde.
7. Evaluar calidad con propiedades argentinas variadas: espacios pequeños, ambientes ya amoblados, puertas y ventanas, todos los estilos y operaciones pagas de mejora de foto y día a atardecer. Estas últimas tienen pruebas de contrato, no una evaluación visual completa con fotos reales.
8. Completar observabilidad, alertas de gasto, limpieza de almacenamiento y procedimiento de soporte antes de escalar la venta.

## Paridad y alcance todavía incompletos

- La referencia exige un plan pago para acceder a su editor completo. No se compró ese plan ni se certificó la paridad de las pantallas privadas pagas.
- La galería propia tiene dos ambientes y la demostración usa Moderno. Faltan ejemplos propios correctos para ampliar ambientes y estilos. La referencia anuncia más de 50 estilos; amoblaIA ofrece diez.
- El blog contiene seis guías originales para Argentina; no replica toda la biblioteca editorial de la referencia.
- API, marca blanca y afiliados reciben solicitudes, pero no aprovisionan claves, despliegues ni pagos de comisiones automáticamente.
- Contacto, soporte, reembolsos, arrepentimiento y newsletter guardan solicitudes; no envían emails automáticamente. Falta definir email comercial y configurar remitente. Por ahora se usa el dominio de Vercel por decisión del usuario.

## Evidencia para retomar

`AUDIT_2026-10-20.md` conserva el mapa de paridad; `REVERSE_ENGINEERING.md` y `rea-pages-summary.json` registran el análisis de la referencia con REA. El análisis estático no prueba el backend del competidor.

Las capturas y métricas están fuera del repositorio, en `outputs/verificacion/auditoria/` del espacio de trabajo. Evidencia útil: `produccion-primera-lista-dos-pendientes-desktop.png`, `produccion-tanda-recuperada-6-propuestas.png`, `google-comprobacion-final.png`, `qa-publica-desktop.json` y `qa-publica-mobile.json`.
