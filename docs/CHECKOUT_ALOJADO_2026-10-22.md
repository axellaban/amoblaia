# Checkout alojado — 22 de octubre de 2026

Se mantiene el catálogo y sus precios. Se reemplaza el formulario embebido de tarjeta por enlaces individuales: Suscripciones para mensual/anual con renovación, Checkout Pro para compras puntuales. Mercado Pago recibe los datos de tarjeta directamente en su propio sitio.

## Comportamiento

1. El cliente autenticado elige un plan y confirma el email que usará en Mercado Pago. Para suscripciones sin plan asociado el proveedor lo vincula a su checkout; no se deduce de Google.
2. El servidor crea una orden con copia del producto y precio, valida el vendedor y obtiene el enlace del proveedor. Los enlaces reabiertos deben continuar pendientes y coincidir con plan/email. Las órdenes inciertas siguen bloqueando reintentos que puedan duplicar una compra.
3. El comprador completa el pago en Mercado Pago y regresa a `/cuenta?orden=...`. El retorno consulta una ruta autenticada que comprueba propiedad y obtiene el estado desde el servidor; ningún `status=approved` de la URL acredita fotos.
4. Solo un pago comprobado y aplicado a la base habilita «Pago confirmado». Pendiente, rechazado, abandonado, cancelado y revisión muestran estados diferentes. Mi cuenta muestra compras abiertas para retomarlas sin conservar la pestaña original.
5. Los webhooks consultan al proveedor y usan el mismo RPC transaccional e idempotente de acreditación. Cerrar la pestaña no impide recibirlos. Un webhook repetido con la misma identidad conserva su estado procesado; los avisos IPN sin identidad no bloquean actualizaciones posteriores.
6. Un cambio de plan conserva el plan anterior durante el checkout. La relación de reemplazo se registra dentro de la creación atómica de la orden y se espera al primer pago aprobado del nuevo antes de cancelar la renovación anterior. Una autorización sin cobro no acredita ni reemplaza el plan.

## Notificaciones y recuperación

Los 404 del detalle de factura tienen una segunda consulta por ID exacto a la búsqueda oficial. Solo una factura encontrada y un pago verificado permiten procesar/acreditar; si falta el recurso también en la búsqueda, queda pendiente con contador y error. No se ocultan los errores del proveedor como si fueran pagos exitosos.

El cron conserva el reintento de eventos y añade una consulta acotada de compras recientes abiertas y renovaciones próximas. El retorno también consulta directamente, permitiendo recuperar un pago antes de recibir su webhook. La conciliación diaria es un respaldo para el volumen inicial; ampliar la cola y paginación al escalar.

## Base de datos

Aplicadas en el proyecto existente, sin cambiar el plan Free:

- `202610210003_billing_hardening.sql`: faltaba la función de conteo de fallos y se aplicaron sus reglas de reversión ya cubiertas por tests.
- `202610220001_hosted_checkout.sql`: creación atómica del reemplazo y bloqueo de cambios simultáneos, incluso cuando el primer enlace ya está listo.

Se comprobó la existencia de las funciones y la restricción de ejecución de la creación de órdenes a roles del servidor.

## Validación

- 181 tests en 32 archivos: identidad del pagador, checkout pendiente y anual, packs, idempotencia, cambio de plan, estados del retorno, aislamiento de órdenes, URL insegura, parámetros de aprobación falsificados, recuperación de facturas, reenvíos de eventos, reversión y permisos SQL.
- TypeScript, ESLint y build de Next.js: comprobación durante la entrega.
- No se realiza ni reintenta un pago real. El cobro aprobado, acreditación visible y primera renovación real requieren una compra completada por el titular/comprador con un medio aceptado por Mercado Pago. El checkout alojado no garantiza una aprobación bancaria.

## Referencias oficiales

- [Suscripciones con pago pendiente](https://www.mercadopago.com.ar/developers/es/docs/subscriptions/integration-configuration/subscription-no-associated-plan/pending-payments)
- [Crear suscripción](https://www.mercadopago.com.ar/developers/es/reference/online-payments/subscriptions/create-preapproval/post)
- [Retorno al sitio](https://www.mercadopago.com.ar/developers/es/docs/checkout-pro/configure-back-urls)
- [Buscar facturas](https://www.mercadopago.com.ar/developers/es/reference/online-payments/subscriptions/authorized-payment-search/get)
- [Webhooks](https://www.mercadopago.com.ar/developers/es/docs/subscriptions/additional-content/your-integrations/notifications/webhooks)
