# Configuración comercial de amoblaIA

La base elegida es **Supabase Free**, conectada directamente por variables a Vercel. No se reutilizan bases de otros proyectos. No hace falta que aparezca como un recurso de Marketplace en la pestaña Storage para que la conexión por API funcione.

## Estado de la instalación

- Proyecto exclusivo: `cmpfwuycxdleunuumlkm`, organización `amoblaia`, plan Free.
- Se aplicó la instalación inicial: once tablas, permisos RLS por cliente, RPCs financieras solo para el servidor y bucket privado `property-images`.
- Los diez productos se crean **sin precio y desactivados**. No se inventan importes rentables en pesos.
- Se comprobaron contra la base real la lectura de una foto propia y el rechazo de otra cuenta, y el bloqueo de mutaciones financieras con la clave pública.
- Google OAuth configurado en el proyecto Cloud `amoblaia`, audiencia externa en producción, únicamente openid/email/perfil. Credencial privada guardada en Supabase. El titular confirmó su ingreso y la base registra una cuenta Google verificada con sesión iniciada.
- Variables Supabase y secretos de servidor guardados en Vercel. `SAAS_ENABLED=true` y `NEXT_PUBLIC_GOOGLE_AUTH_ENABLED=true` para el nuevo despliegue. Cobros y prueba real automática siguen desactivados.
- Actualización de presupuesto de almacenamiento aplicada: `202610200002_storage_budget.sql`.

## Límites gratuitos

Supabase publica 500 MB de base de datos, 1 GB de archivos y dos proyectos gratuitos activos por cuenta, con condiciones por organización y miembros. El plan Free puede pausarse por inactividad. No es una base gratuita de cada tipo por proyecto de Vercel.

El motor reserva 4 MB de espacio por trabajo pendiente y frena nuevas generaciones al llegar a un presupuesto conservador de **800 MiB** de fotos y resultados. El proveedor mantiene sus propios límites; el cálculo interno no sustituye su contador y puede diferir por archivos huérfanos o registros incompletos. No se activó un plan de pago ni se garantiza almacenamiento ilimitado.

Vercel Hobby está limitado a uso personal no comercial. Resolver el hosting comercial antes de habilitar cobros. El costo de OpenAI y las comisiones de Mercado Pago son independientes del plan gratuito de la base.

Referencias: [Supabase](https://supabase.com/pricing), [cupo de proyectos](https://supabase.com/docs/guides/platform/billing-faq), [Vercel Hobby](https://vercel.com/docs/plans/hobby).

## Variables de Supabase en Vercel

En **amoblaia → Settings → Environment Variables**, crear:

| Nombre                               | Tipo                                    | Entorno    |
| ------------------------------------ | --------------------------------------- | ---------- |
| NEXT_PUBLIC_SUPABASE_URL             | Config, pública                         | Production |
| NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY | Config, pública                         | Production |
| SUPABASE_SECRET_KEY                  | Secret, privada                         | Production |
| APP_URL                              | Config                                  | Production |
| ADMIN_EMAILS                         | Config, solo servidor                   | Production |
| SAAS_ENABLED                         | Config                                  | Production |
| BILLING_ENABLED                      | Config                                  | Production |
| LIVE_TRIAL_ENABLED                   | Config                                  | Production |
| NEXT_PUBLIC_GOOGLE_AUTH_ENABLED      | Config                                  | Production |
| NEXT_PUBLIC_EMAIL_AUTH_ENABLED       | Config                                  | Production |
| CRON_SECRET                          | Secret, mínimo 32 caracteres aleatorios | Production |
| MERCADOPAGO_NOTIFICATION_TOKEN       | Secret, mínimo 32 caracteres aleatorios | Production |

La clave privada nunca lleva NEXT_PUBLIC. La clave publishable está diseñada para el navegador y depende de RLS. Tras cambios de variables públicas es necesario un nuevo build/deploy.

Si se instala desde cero, ejecutar primero `supabase/migrations/202610200001_commerce.sql` en el SQL Editor de un proyecto nuevo. Luego ejecutar las migraciones posteriores en orden. No volver a ejecutar la instalación inicial sobre tablas existentes. La actualización `202610200002_storage_budget.sql` es compatible con la instalación inicial actual.

## Acceso con Google, sin dominio propio

No requiere un remitente SMTP. Requiere configurar OAuth:

1. En Google Cloud, crear o usar un proyecto exclusivo para amoblaIA. No contratar recursos de cómputo ni habilitar facturación para este paso.
2. Configurar Google Auth Platform: audiencia externa, nombre amoblaIA y contacto del propietario. Solicitar únicamente `openid`, email y perfil.
3. Crear un **cliente OAuth de tipo Aplicación web**.
4. Origen autorizado: `https://amoblaia.vercel.app`.
5. URI de redirección de Google: `https://cmpfwuycxdleunuumlkm.supabase.co/auth/v1/callback`.
6. En Supabase → Authentication → Sign In / Providers → Google, habilitar Google y pegar Client ID y Client Secret. El secreto de Google se guarda ahí, no en el código ni en el chat.
7. En Authentication → URL Configuration, Site URL: `https://amoblaia.vercel.app`. Agregar `https://amoblaia.vercel.app/auth/callback` y `https://amoblaia.vercel.app/auth/confirm` a las redirecciones permitidas.
8. Si Google está en modo Testing, agregar expresamente los usuarios de prueba. Antes de abrir altas públicas, revisar la publicación de la audiencia y cualquier requisito de verificación que muestre Google.
9. Cambiar `NEXT_PUBLIC_GOOGLE_AUTH_ENABLED=true` y `SAAS_ENABLED=true`; redeploy y probar alta, cierre de sesión, reingreso e historial desde otro navegador.

No se guardan tokens de Google para acceder a Gmail o Drive. Solo se usa la identidad para crear la sesión de Supabase.

Referencia: [Google con Supabase](https://supabase.com/docs/guides/auth/social-login/auth-google).

## Email y contraseña, alternativa posterior

El SMTP de prueba de Supabase solo envía a miembros autorizados del equipo y tiene límites muy bajos. Para altas generales configurar SMTP propio y verificar dominio/remitente con el proveedor elegido. Mantener confirmación de email habilitada; no desactivarla para sortear el envío.

Activar `NEXT_PUBLIC_EMAIL_AUTH_ENABLED=true` después de configurar SMTP. El código incluye registro, recuperación y actualización de contraseña y admite enlaces PKCE y token_hash. Antes de activarlo, cambiar las plantillas de email de Supabase (Authentication → Email Templates) para que los enlaces usen token_hash, que funciona en cualquier dispositivo: confirmación `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=signup` y recuperación `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery`. El enlace por defecto (PKCE) solo funciona en el navegador que pidió el email. `/auth/confirm` muestra un botón «Continuar» y recién ahí inicia sesión, para que un enlace ajeno no pueda iniciar sesión en otra cuenta. Para producción configurar CAPTCHA Turnstile en Supabase y `NEXT_PUBLIC_TURNSTILE_SITE_KEY` en Vercel. No pegar la clave secreta de Turnstile en el frontend.

Referencias: [SMTP](https://supabase.com/docs/guides/auth/auth-smtp), [CAPTCHA](https://supabase.com/docs/guides/auth/auth-captcha).

## Mercado Pago

Aplicación indicada por el titular: `4931907475590636`, creada como **Checkout Pro**. El backend usa Checkout Pro para packs y la API de Suscripciones para mensual/anual; no maneja números de tarjeta. La configuración y homologación del proveedor sigue pendiente: el panel solicitó verificación de la cuenta antes de abrir Webhooks. No se habilitaron ventas ni se efectuaron pagos.

El modo de prueba solo permite iniciar checkouts al administrador: los botones de compra en `/precios` aparecen únicamente para los emails de `ADMIN_EMAILS` y siguen ocultos para el público. No habilitar pruebas financieras abiertas a clientes. La variable `MERCADOPAGO_MODE=production` y los demás controles comerciales deben estar completos antes de vender.

Cargar en Vercel:

- `MERCADOPAGO_ACCESS_TOKEN`: credencial privada del vendedor.
- `MERCADOPAGO_COLLECTOR_ID`: ID del vendedor. El servidor rechaza pagos de otro vendedor.
- `MERCADOPAGO_WEBHOOK_SECRET`: opcional mientras la cuenta no esté verificada. Es la firma secreta del panel de Webhooks; cuando está cargada, toda notificación firmada debe validar esa firma.
- `MERCADOPAGO_MODE`: `test` para pruebas y `production` cuando se hayan validado los cobros reales.
- `MERCADOPAGO_NOTIFICATION_TOKEN`: token aleatorio para las notificaciones de suscripciones que no incluyan firma.

### Probar sin el panel de Webhooks

La verificación de la cuenta solo bloquea el panel de Webhooks; no impide probar. Cada checkout ya envía su propia `notification_url` con el token privado, así que las notificaciones de packs y suscripciones llegan sin configurar el panel. Mientras falte `MERCADOPAGO_WEBHOOK_SECRET`, el servidor autentica con ese token e ignora la firma. También acepta el formato IPN (`?topic=payment&id=...`) que Mercado Pago envía a la misma URL y responde 200 a `merchant_order` sin procesarlo.

1. En Mercado Pago Developers → Tus integraciones → amoblaIA → **Cuentas de prueba**, crear un vendedor y un comprador de prueba.
2. Copiar en Vercel las credenciales del vendedor de prueba: `MERCADOPAGO_ACCESS_TOKEN` y su ID de usuario como `MERCADOPAGO_COLLECTOR_ID`. Dejar `MERCADOPAGO_MODE=test`.
3. Cargar `MERCADOPAGO_NOTIFICATION_TOKEN`, `SELLER_NAME`, `SELLER_CUIT`, `SUPPORT_EMAIL` o `NEXT_PUBLIC_CONTACT_URL` y `BILLING_ENABLED=true`. Redeploy.
4. En Administración, fijar un precio de prueba y activar un pack.
5. Ingresar con un email de `ADMIN_EMAILS`, abrir `/precios`, comprar el pack e iniciar sesión en el checkout con el comprador de prueba. Usar las tarjetas de prueba de la documentación de Mercado Pago.
6. Confirmar en Mi cuenta que el saldo sube una sola vez y en la tabla `webhook_events` que el evento tenga `processed_at` sin `last_error`. Si `last_error` dice `SELLER_MISMATCH` o `PAYMENT_MODE_MISMATCH`, revisar el collector ID y el modo.

Cuando la cuenta esté verificada, configurar el panel de Webhooks y cargar `MERCADOPAGO_WEBHOOK_SECRET` antes de pasar a producción.

### Notificaciones

Ruta: `/api/webhooks/mercadopago`. La creación de cada checkout agrega una notification_url con el token de servidor. No publicar esa URL completa. Configurar los eventos `payment`, `subscription_preapproval` y `subscription_authorized_payment` según la configuración que admita el producto. La documentación de Suscripciones indica que sus avisos se configuran durante la creación del pago mediante notification_url; la configuración genérica del panel no aplica a ese flujo. Los packs sí utilizan el panel Webhooks.

Las notificaciones se guardan antes de responder. Luego se consulta la API de Mercado Pago y se validan vendedor, moneda, importe, ambiente, orden y relación de la factura con la suscripción. La firma se verifica cuando viene presente; los callbacks sin firma requieren el token aleatorio. La acreditación tiene claves únicas y transacciones, por lo que los reintentos no duplican fotos. Un retorno `success` o una suscripción `authorized` sin pago aprobado no habilitan saldo.

El anual cobra una vez y habilita el cupo mes a mes. El saldo se actualiza también al consultar la cuenta y al reservar una generación. Cancelar conserva el período pagado. Un reembolso o contracargo revoca los créditos del pago afectado; los casos con consumo o reembolso parcial requieren revisión. No se implementan prorrateos automáticos ni devolución automática por cambio de plan.

Referencias: [Suscripciones](https://www.mercadopago.com.ar/developers/es/docs/subscriptions/overview), [notificaciones](https://www.mercadopago.com.ar/developers/es/docs/subscriptions/additional-content/your-integrations/notifications/webhooks), [Checkout Pro](https://www.mercadopago.com.ar/developers/es/docs/checkout-pro-preferences/overview).

## Catálogo y precios

- Packs: 10 y 25 fotos, sin renovación automática ni vencimiento.
- Planes: 6, 20, 60 y 150 fotos originales por mes.
- Tres resultados en total por foto original, sumando estilos y operaciones. Las descargas no gastan fotos.
- Los cupos mensuales no se acumulan.
- Prueba opcional: una foto por cuenta verificada, una sola vez, con vencimiento de 30 días.
- El panel administrativo permite fijar precios en ARS. Puede calcular un anual equivalente a diez mensualidades; siempre muestra el total anual cobrado.
- Una compra conserva una copia de precio y alcance. Cambiar el catálogo no cambia silenciosamente suscripciones existentes.

El consumo se registra con `usage` cuando OpenAI lo devuelve. La estimación USD solo se calcula si el operador configura tarifas. No constituye una factura del proveedor y debe contrastarse con la cuenta real, especialmente si hay tarifas distintas para tipos de tokens o caché. Medir el costo por foto satisfactoria antes de fijar el precio comercial o ampliar regeneraciones.

## Trabajos en segundo plano y límites

El pedido se registra con una clave idempotente. La reserva de foto, el límite de tres variantes y la decisión de iniciar un trabajo son transacciones SQL. `after()` permite completar el trabajo tras devolver el ID al navegador, dentro del máximo de 300 segundos de la función. Cerrar la pestaña no elimina el registro ni cancela el trabajo del servidor.

Esto **no es un sistema de ejecución ilimitada con entrega garantizada**: un corte del proceso o timeout puede dejar una solicitud en estado incierto. No se reenvía automáticamente al proveedor para evitar otro cargo. El cron diario mueve trabajos interrumpidos a revisión, reintenta notificaciones guardadas y recupera un trabajo en espera. Consultar un trabajo en espera también intenta despacharlo, con claim atómico para evitar ejecuciones duplicadas.

El administrador puede recuperar un resultado ya guardado, o confirmar una falla y devolver la foto si corresponde. Debe revisar primero el consumo del proveedor. Para mayor volumen, reemplazar este despachador por una cola durable con reintentos y conciliación específicos del proveedor.

## Antes de activar ventas

1. Acceso real verificado y RLS probado entre dos cuentas.
2. Definir precios en ARS con medición del consumo y condiciones efectivas de Mercado Pago.
3. Homologar pack, mensual y anual; rechazo, pendiente, renovación, cancelación, reembolso, contracargo y notificación duplicada. Realizar una compra controlada real solo cuando el titular la autorice.
4. Completar `SELLER_NAME`, `SELLER_CUIT` y al menos un canal válido de soporte. Resolver facturación según condición fiscal; no hay emisión automática ARCA en esta versión.
5. Revisar condiciones, privacidad, bajas y arrepentimiento para el servicio concreto. La página de soporte debe tener un canal operativo; no es un sistema de tickets ni un formulario de baja legal completo por sí solo.
6. Usar únicamente imágenes autorizadas en la galería comercial. Los ejemplos nuevos generados son escenas ficticias y deben identificarse como ilustrativos.
7. Resolver el hosting para uso comercial. No se contrató Vercel Pro automáticamente.
8. Activar productos desde Administración y, al final, `BILLING_ENABLED=true`.

No hay promesa de funcionamiento de pagos en producción hasta completar esta homologación con las credenciales del titular.

## Actualización de la auditoría del 20/10/2026

Aplicar en orden las migraciones 006 a 009: email de checkout y 25 resultados gratuitos, consultas registradas, carpetas/papelera y regeneraciones pagas durante cobertura vigente. Se aplicaron al proyecto existente desde SQL Editor sin cambiar el plan Free. No volver a ejecutar la migración 008 completa si ya está aplicada.

El login usa el botón nativo de Google Identity Services. `NEXT_PUBLIC_GOOGLE_CLIENT_ID` es público; el secreto sigue en Supabase. Debe estar autorizado `https://amoblaia.vercel.app` como origen JavaScript en el cliente de Google. Se conserva el callback PKCE para otros accesos existentes.

Los cobros piden el email de Mercado Pago al comprador. `orders.payer_email` controla la reutilización del enlace; no se debe volver a utilizar un enlace antiguo con otro email. El precio se vuelve a mostrar completo antes de ir a Mercado Pago, incluyendo frecuencia y renovación.

Los resultados gratuitos históricos se marcan `is_free` antes de contar el límite 25. `credit_grants` mantiene el saldo de originales pagos separado. `projects.trashed_at` conserva archivos recuperables; `deleted_at` identifica eliminaciones definitivas anteriores o nuevas. La papelera no restituye créditos.

Los formularios guardan solicitudes en `contact_requests`, solo legible por el backend y Administración. Hay deduplicación y un máximo de cinco solicitudes nuevas por origen/hora. No hay envío automático de emails ni reembolsos automáticos desde esos formularios.

Ver `AUDIT_2026-10-20.md` para cobertura y diferencias con la referencia.

### Prueba sin registro y recorrido inicial

Aplicar `202610200010_guest_trial.sql` y `202610200011_guest_origin_usage.sql` después de 009; luego `202610200012_generation_batches.sql`. Habilitar `Allow anonymous sign-ins` en Supabase Auth → Sign In / Providers (aplicado el 20/10/2026). No se habilita manual linking ni se desactiva confirmación de email. RLS solo permite lectura de filas propias y los RPC de mutación continúan reservados al servidor. Las compras requieren una cuenta verificada.

`POST /api/guest` crea/reutiliza una sesión anónima y conserva una cookie HttpOnly firmada para trasladar fotos al iniciar sesión con Google. La firma usa la credencial existente del servidor; no requiere nuevas variables. El merge es idempotente y bloquea el invitado anterior. El cupo de 25 cuenta toda su historia, incluso papelera. Se agrega un límite de 25 resultados por origen en 24 horas y cinco altas anónimas por origen; la huella usa HMAC del encabezado de origen de Vercel. No es una prueba de identidad ni impide a una persona cambiar de red/dispositivo. Mantener los topes globales de IA y almacenamiento.

El tour guarda `profiles.onboarding_completed_at`; puede reabrirse desde Mis fotos. Las tandas de hasta tres trabajos se reservan atómicamente y se ejecutan en paralelo, con un máximo de una tanda activa por cuenta. El reintento con la misma clave recupera los trabajos existentes. Una falla confirmada devuelve su cupo sin descartar los resultados exitosos. El estado se recupera al recargar.
