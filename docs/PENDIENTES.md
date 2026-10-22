# Estado de entrega y pendientes — 20 de octubre de 2026

Se detiene el trabajo a pedido del usuario para conservar créditos. Los cambios funcionales ya están en `main`, publicados hasta `2b4ae45` (`Reserve persistent batches and render proposals independently in parallel`). No hay una rama de funcionalidades pendiente de merge. Esta nota no certifica que el producto esté listo para vender sin restricciones.

Producción: https://amoblaia.vercel.app/

## Corrección de checkout — 22 de octubre de 2026

- El error reportado `guest_site_mismatch` identifica una incompatibilidad entre el sitio/país del pagador y el del cobro. El mensaje anterior lo presentaba como tarjeta rechazada.
- Card Payment Brick recibía el email de Google en `initialization.payer.email`, lo que oculta su campo de email. Además, la app descartaba `payer.email` de `onSubmit` y el backend lo reemplazaba por el email de Google (o un email de prueba configurado). Se corrigieron ambos extremos: el email queda visible y editable en el Brick y se transmite con el token de la tarjeta hasta `/preapproval`, validado y normalizado en el servidor. El usuario autenticado sigue siendo el dueño de la orden; el email de pago no cambia su cuenta.
- Si Mercado Pago vuelve a informar incompatibilidad de país, el mensaje indica corregir el email por uno de Mercado Pago Argentina. El detalle técnico queda en los logs del servidor y no se incluye en el checkout, tampoco para administradores. La orden rechazada se cierra para permitir otro intento.
- La clave pública publicada devuelve los tipos de documento argentinos (DNI, Cédula, L.C., L.E. y Otro) en la API de Mercado Pago. La lectura de credenciales privadas en Vercel exige una verificación adicional; no se modificaron ni se copiaron. Esto no certifica la aprobación de una tarjeta o una cuenta pagadora concreta.
- Verificación de la corrección: 156 tests en 26 archivos aprobados, TypeScript, ESLint y build correctos. El SDK real mostró el campo de email editable en una vista local del mismo componente de checkout; verificado en escritorio y móvil de 390 px, sin desbordamiento horizontal. Los cobros del entorno local permanecieron deshabilitados y no se enviaron tarjetas. Evidencia en `outputs/verificacion/checkout-email-editable-{desktop,mobile}.png`, fuera del repositorio. La vista temporal de QA se eliminó antes del commit.
- Falta completar la compra controlada con un comprador de Argentina distinto del vendedor y comprobar su acreditación. No se efectuaron cargos durante esta corrección. Si el propio email del comprador está asociado a otro país, ese vínculo debe resolverse con Mercado Pago o usando su email de Argentina; la app no puede cambiarlo.
- Referencia del contrato del Brick: https://github.com/mercadopago/sdk-js/blob/main/docs/bricks/card-payment.md (`initialization.payer.email` y `CardData.payer.email`).

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
